import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const MAIL_FROM = defineSecret("MAIL_FROM");

admin.initializeApp();

type Jurisdiccion = "nacional" | "federal" | "caba" | "provincia_bs_as";
type AssignmentMode = "auto" | "direct";

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

async function assertAuthenticated(request: any) {
  if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado.");
  return request.auth.uid as string;
}

async function assertAdmin(request: any) {
  const uid = await assertAuthenticated(request);
  const snap = await admin.firestore().collection("users").doc(uid).get();
  const role = String((snap.data() as any)?.role ?? "lawyer");
  if (role !== "admin") throw new HttpsError("permission-denied", "Solo admin.");
  return uid;
}

/* =========================================================
   CREATE CASE + INVITES
   ========================================================= */

export const createCaseWithInvites = onCall(async (request) => {
  const creatorUid = await assertAuthenticated(request);

  // Validar que exista perfil
  const creatorDoc = await admin.firestore().collection("users").doc(creatorUid).get();
  if (!creatorDoc.exists) throw new HttpsError("failed-precondition", "No existe perfil de usuario.");

  const data = request.data as {
    caratulaTentativa?: string;
    specialtyId?: string;
    objeto?: string;
    resumen?: string;
    jurisdiccion?: Jurisdiccion;

    broughtByParticipates?: boolean;
    assignmentMode?: AssignmentMode;

    directAssigneesUids?: string[];
    directJustification?: string;
  };

  const caratulaTentativa = String(data?.caratulaTentativa ?? "").trim();
  const specialtyId = String(data?.specialtyId ?? "").trim();
  const objeto = String(data?.objeto ?? "").trim();
  const resumen = String(data?.resumen ?? "").trim();
  const jurisdiccion = data?.jurisdiccion as Jurisdiccion;

  const broughtByParticipates = !!data?.broughtByParticipates;
  const assignmentMode = (data?.assignmentMode ?? "auto") as AssignmentMode;

  if (!caratulaTentativa) throw new HttpsError("invalid-argument", "Falta carátula tentativa.");
  if (!specialtyId) throw new HttpsError("invalid-argument", "Falta specialtyId.");
  if (!objeto) throw new HttpsError("invalid-argument", "Falta objeto.");
  if (!resumen) throw new HttpsError("invalid-argument", "Falta resumen.");
  if (!jurisdiccion) throw new HttpsError("invalid-argument", "Falta jurisdicción.");

  // Regla: siempre se asignan 2 abogados finales.
  const requiredAssigneesCount = 2;

  // Confirmados iniciales: si participa, el creador queda confirmado.
  const confirmedAssigneesUids = broughtByParticipates ? [creatorUid] : [];

  // Determinar a quién invitar (UIDs)
  let inviteUids: string[] = [];

  if (assignmentMode === "direct") {
    const just = String(data?.directJustification ?? "").trim();
    const direct = uniq((data?.directAssigneesUids ?? []).map(String));

    const requiredInvites = broughtByParticipates ? 1 : 2;

    if (direct.length !== requiredInvites) {
      throw new HttpsError(
        "invalid-argument",
        `Asignación directa requiere ${requiredInvites} invitado(s).`
      );
    }
    if (just.length < 10) {
      throw new HttpsError("invalid-argument", "Justificación obligatoria (mínimo 10 caracteres).");
    }

    // No permitir invitarse a uno mismo
    if (direct.includes(creatorUid)) {
      throw new HttpsError("invalid-argument", "No podés invitarte a vos mismo.");
    }

    inviteUids = direct;
  } else {
    // AUTO: turno estricto por especialidad
    const needed = requiredAssigneesCount - confirmedAssigneesUids.length; // 1 o 2
    if (needed <= 0) {
      inviteUids = [];
    } else {
      const usersQ = admin
        .firestore()
        .collection("users")
        .where("isPracticing", "==", true)
        .where("specialties", "array-contains", specialtyId);

      await admin.firestore().runTransaction(async (tx) => {
        const usersSnap = await tx.get(usersQ);

        const candidates = usersSnap.docs
          .map((d) => ({ uid: d.id, email: (d.data() as any)?.email ?? "" }))
          .filter((u) => (broughtByParticipates ? u.uid !== creatorUid : true))
          .sort((a, b) => String(a.email).localeCompare(String(b.email))); // orden estable

        if (candidates.length < needed) {
          throw new HttpsError("failed-precondition", "No hay suficientes abogados elegibles en esa especialidad.");
        }

        const rotRef = admin.firestore().collection("rotationState").doc(specialtyId);
        const rotSnap = await tx.get(rotRef);
        const cursor = rotSnap.exists ? Number((rotSnap.data() as any)?.cursor ?? 0) : 0;

        const picked: string[] = [];
        let idx = cursor;

        while (picked.length < needed) {
          const u = candidates[idx % candidates.length];
          if (!picked.includes(u.uid)) picked.push(u.uid);
          idx++;
        }

        inviteUids = picked;

        // avanzar cursor
        tx.set(
          rotRef,
          {
            cursor: idx % candidates.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    }
  }

  // Crear caso + invitaciones
  const caseRef = admin.firestore().collection("cases").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const directJustification = assignmentMode === "direct" ? String(data?.directJustification ?? "").trim() : "";
  const directAssigneesUids = assignmentMode === "direct" ? inviteUids : [];

  await admin.firestore().runTransaction(async (tx) => {
    // 1) LECTURAS (todas primero)
    const userRefs = inviteUids.map((u) => admin.firestore().collection("users").doc(u));
    const userSnaps = await Promise.all(userRefs.map((ref) => tx.get(ref)));

    const emailByUid = new Map<string, string>();
    userSnaps.forEach((snap) => {
      const email = snap.exists ? String((snap.data() as any)?.email ?? "") : "";
      emailByUid.set(snap.id, email);
    });

    // 2) ESCRITURAS
    tx.set(caseRef, {
      caratulaTentativa,
      specialtyId,
      objeto,
      resumen,
      jurisdiccion,

      broughtByUid: creatorUid,
      broughtByParticipates,

      assignmentMode,
      directAssigneesUids,
      directJustification,

      requiredAssigneesCount,
      confirmedAssigneesUids,

      status: "draft",
      createdAt: now,
    });

    for (const invitedUid of inviteUids) {
      const invitedEmail = emailByUid.get(invitedUid) ?? "";
      const inviteRef = caseRef.collection("invites").doc();

      tx.set(inviteRef, {
        invitedUid,
        invitedEmail,
        status: "pending",
        invitedAt: now,
        respondedAt: null,

        mode: assignmentMode,
        directJustification: assignmentMode === "direct" ? directJustification : "",
        createdByUid: creatorUid,
      });
    }
  });

  return { caseId: caseRef.id };
});

/* =========================================================
   RESPOND INVITE + REINVITE + EMAIL
   ========================================================= */

export const respondInvite = onCall(
  { secrets: [SENDGRID_API_KEY, MAIL_FROM] },
  async (request) => {
    try {
      const uid = await assertAuthenticated(request);

      const data = request.data as {
        caseId?: string;
        inviteId?: string;
        decision?: "accepted" | "rejected";
      };

      const caseId = String(data?.caseId ?? "");
      const inviteId = String(data?.inviteId ?? "");
      const decision = data?.decision;

      if (!caseId || !inviteId) throw new HttpsError("invalid-argument", "Falta caseId/inviteId.");
      if (decision !== "accepted" && decision !== "rejected") {
        throw new HttpsError("invalid-argument", "Decisión inválida.");
      }

      const caseRef = admin.firestore().collection("cases").doc(caseId);
      const inviteRef = caseRef.collection("invites").doc(inviteId);

      await admin.firestore().runTransaction(async (tx) => {
        // ===== 1) READS (todo antes de escribir)
        const [caseSnap, inviteSnap] = await Promise.all([tx.get(caseRef), tx.get(inviteRef)]);
        if (!caseSnap.exists) throw new HttpsError("not-found", "Causa no existe.");
        if (!inviteSnap.exists) throw new HttpsError("not-found", "Invitación no existe.");

        const invite = inviteSnap.data() as any;
        if (String(invite.invitedUid ?? "") !== uid) throw new HttpsError("permission-denied", "No sos el invitado.");
        if (String(invite.status ?? "") !== "pending") throw new HttpsError("failed-precondition", "Invitación ya respondida.");

        const c = caseSnap.data() as any;

        const assignmentMode: "auto" | "direct" = (c.assignmentMode ?? "auto") as any;
        const specialtyId: string = String(c.specialtyId ?? "");
        const broughtByParticipates: boolean = !!c.broughtByParticipates;
        const broughtByUid: string = String(c.broughtByUid ?? "");
        const required: number = Number(c.requiredAssigneesCount ?? 2);
        const confirmed: string[] = Array.isArray(c.confirmedAssigneesUids) ? c.confirmedAssigneesUids : [];
        const status: string = String(c.status ?? "draft");
        const directJustificationFromCase: string = String(c.directJustification ?? "");

        const now = admin.firestore.FieldValue.serverTimestamp();

        const invitesSnap = await tx.get(caseRef.collection("invites"));
        const alreadyInvited = new Set<string>();
        invitesSnap.docs.forEach((d) => {
          const dta = d.data() as any;
          if (dta?.invitedUid) alreadyInvited.add(String(dta.invitedUid));
        });

        const blocked = new Set<string>([...confirmed, ...alreadyInvited]);
        if (broughtByParticipates) blocked.add(broughtByUid);

        const remainingNeeded = Math.max(0, required - confirmed.length);

        const shouldReplace =
          decision === "rejected" &&
          status !== "assigned" &&
          remainingNeeded > 0;

        let nextUid: string | null = null;
        let nextEmail = "";
        let nextCursor: number | null = null;
        let rotRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData> | null = null;

        if (shouldReplace) {
          let usersQ: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;

          if (assignmentMode === "auto") {
            if (!specialtyId) throw new HttpsError("failed-precondition", "La causa no tiene specialtyId.");
            usersQ = admin
              .firestore()
              .collection("users")
              .where("isPracticing", "==", true)
              .where("specialties", "array-contains", specialtyId);
            rotRef = admin.firestore().collection("rotationState").doc(specialtyId);
          } else {
            usersQ = admin.firestore().collection("users").where("isPracticing", "==", true);
            // IMPORTANTE: "direct" (no __direct__)
            rotRef = admin.firestore().collection("rotationState").doc("direct");
          }

          const usersSnap = await tx.get(usersQ);

          const candidates = usersSnap.docs
            .map((d) => ({ uid: d.id, email: String((d.data() as any)?.email ?? "") }))
            .filter((u) => !blocked.has(u.uid))
            .sort((a, b) => a.email.localeCompare(b.email));

          if (candidates.length === 0) {
            throw new HttpsError(
              "failed-precondition",
              assignmentMode === "auto"
                ? "No hay más abogados elegibles para reemplazo en esa especialidad."
                : "No hay más abogados elegibles para reemplazo (direct/global)."
            );
          }

          const rotSnap = await tx.get(rotRef);
          const cursor = rotSnap.exists ? Number((rotSnap.data() as any)?.cursor ?? 0) : 0;

          const picked = candidates[cursor % candidates.length];
          nextUid = picked.uid;
          nextEmail = picked.email;
          nextCursor = (cursor + 1) % candidates.length;
        }

        // ===== 2) WRITES
        tx.update(inviteRef, { status: decision, respondedAt: now });

        if (decision === "accepted") {
          const newConfirmed = Array.from(new Set([...confirmed, uid]));
          const done = newConfirmed.length >= required;

          tx.update(caseRef, {
            confirmedAssigneesUids: newConfirmed,
            status: done ? "assigned" : "draft",
          });

          return;
        }

        // rejected => reinvitar
        if (shouldReplace && nextUid && nextCursor !== null && rotRef) {
          const newInviteRef = caseRef.collection("invites").doc();

          tx.set(newInviteRef, {
            invitedUid: nextUid,
            invitedEmail: nextEmail,
            status: "pending",
            invitedAt: now,
            respondedAt: null,
            mode: assignmentMode,
            directJustification: assignmentMode === "direct" ? directJustificationFromCase : "",
            createdByUid: broughtByUid,
          });

          tx.set(rotRef, { cursor: nextCursor, updatedAt: now }, { merge: true });
          tx.update(caseRef, { status: "draft" });
        }
      });

      // ======================
      // Email al creador (best-effort)
      // ======================
      const caseSnapEmail = await admin.firestore().collection("cases").doc(caseId).get();
      const caseDataEmail = caseSnapEmail.data() as any;

      const creatorUidEmail = String(caseDataEmail?.broughtByUid ?? "");
      const caratulaEmail = String(caseDataEmail?.caratulaTentativa ?? caseId);

      let creatorEmail = "";
      if (creatorUidEmail) {
        const creatorSnap = await admin.firestore().collection("users").doc(creatorUidEmail).get();
        creatorEmail = String((creatorSnap.data() as any)?.email ?? "");
      }

      let emailSent = false;
      let emailError: string | null = null;

      try {
        if (creatorEmail) {
          const apiKey = SENDGRID_API_KEY.value();
          const from = MAIL_FROM.value();

          if (!apiKey || !from) {
            emailError = "SendGrid no configurado (faltan secrets).";
          } else {
            sgMail.setApiKey(apiKey);

            const decisionLabel = decision === "accepted" ? "ACEPTADA" : "RECHAZADA";

            await sgMail.send({
              to: creatorEmail,
              from,
              subject: `Invitación ${decisionLabel} — ${caratulaEmail}`,
              text:
                `Novedad sobre la causa:\n\n` +
                `Carátula: ${caratulaEmail}\n` +
                `Decisión del invitado: ${decisionLabel}\n` +
                `CaseId: ${caseId}\n`,
            });

            emailSent = true;
          }
        }
      } catch (e: any) {
        emailError = e?.message ?? String(e);
        console.error("SendGrid email error:", e?.response?.body ?? e);
      }

      return { ok: true, emailSent, emailError };
    } catch (e: any) {
      console.error("respondInvite error:", e);
      if (e?.code && typeof e.code === "string") throw e;

      const msg = e?.message ? String(e.message) : "Error interno (sin detalle).";
      throw new HttpsError("internal", msg);
    }
  }
);

/* =========================================================
   ADMIN: LAWYERS MANAGEMENT
   ========================================================= */

export const adminCreateLawyer = onCall(async (request) => {
  await assertAdmin(request);

  const data = request.data as {
    email?: string;
    password?: string;
    specialties?: string[];
    isPracticing?: boolean;
    role?: "lawyer" | "admin";
  };

  const email = String(data?.email ?? "").trim().toLowerCase();
  const password = String(data?.password ?? "");
  const specialties = Array.isArray(data?.specialties) ? data.specialties : [];
  const isPracticing = data?.isPracticing !== false; // default true
  const role = (data?.role ?? "lawyer") as "lawyer" | "admin";

  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "Email inválido.");
  if (password.length < 6) throw new HttpsError("invalid-argument", "Password mínimo 6 caracteres.");

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
      disabled: false,
    });
  } catch (e: any) {
    throw new HttpsError("already-exists", e?.message ?? "No se pudo crear el usuario.");
  }

  const uid = userRecord.uid;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await admin.firestore().collection("users").doc(uid).set(
    {
      email,
      role,
      isPracticing,
      specialties,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  return { ok: true, uid };
});

export const adminUpdateLawyerProfile = onCall(async (request) => {
  await assertAdmin(request);

  const data = request.data as {
    uid?: string;
    specialties?: string[];
    isPracticing?: boolean;
  };

  const uid = String(data?.uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "Falta uid.");

  const specialties = Array.isArray(data?.specialties) ? data.specialties : [];
  const isPracticing = !!data?.isPracticing;

  await admin.firestore().collection("users").doc(uid).set(
    {
      specialties,
      isPracticing,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
});

export const adminSetLawyerPassword = onCall(async (request) => {
  await assertAdmin(request);

  const data = request.data as { uid?: string; password?: string };
  const uid = String(data?.uid ?? "");
  const password = String(data?.password ?? "");

  if (!uid) throw new HttpsError("invalid-argument", "Falta uid.");
  if (password.length < 6) throw new HttpsError("invalid-argument", "Password mínimo 6 caracteres.");

  await admin.auth().updateUser(uid, { password });
  await admin.firestore().collection("users").doc(uid).set(
    { updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { ok: true };
});

export const adminDeleteLawyer = onCall(async (request) => {
  await assertAdmin(request);

  const data = request.data as { uid?: string };
  const uid = String(data?.uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "Falta uid.");

  try {
    await admin.auth().deleteUser(uid);
  } catch (e: any) {
    console.warn("deleteUser warn:", e?.message ?? e);
  }

  await admin.firestore().collection("users").doc(uid).delete();

  return { ok: true };
});

/**
 * Compatibilidad: si tu frontend viejo llama createLawyer.
 * Deja role "lawyer" (NO "abogado") para que assertAdmin funcione.
 */
export const createLawyer = onCall(async (request) => {
  await assertAdmin(request);

  const data = request.data as { email?: string; password?: string; specialties?: string[] };
  const email = String(data?.email ?? "").trim().toLowerCase();
  const password = String(data?.password ?? "");
  const specialties = Array.isArray(data?.specialties) ? data.specialties : [];

  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "Email inválido.");
  if (password.length < 6) throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password });
  } catch (e: any) {
    throw new HttpsError("already-exists", e?.message ?? "No se pudo crear el usuario.");
  }

  const uid = userRecord.uid;

  await admin.firestore().collection("users").doc(uid).set(
    {
      email,
      role: "lawyer",
      isPracticing: true,
      specialties,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { uid };
});

export const adminListAuthUsers = onCall(async (request) => {
  await assertAdmin(request);

  const pageSize = 1000;
  const users: Array<{ uid: string; email: string }> = [];

  let nextPageToken: string | undefined = undefined;

  do {
    const res = await admin.auth().listUsers(pageSize, nextPageToken);
    for (const u of res.users) {
      if (u.email) users.push({ uid: u.uid, email: u.email.toLowerCase() });
    }
    nextPageToken = res.pageToken;
  } while (nextPageToken);

  users.sort((a, b) => a.email.localeCompare(b.email));

  return { users };
});

export const adminEnsureUserProfile = onCall(async (request) => {
  await assertAdmin(request);

  const data = request.data as { uid?: string; email?: string };

  const uid = String(data?.uid ?? "");
  const email = String(data?.email ?? "").trim().toLowerCase();
  if (!uid || !email) throw new HttpsError("invalid-argument", "Falta uid/email.");

  const ref = admin.firestore().collection("users").doc(uid);
  const snap = await ref.get();

  await ref.set(
    {
      email,
      role: snap.exists ? String((snap.data() as any)?.role ?? "lawyer") : "lawyer",
      isPracticing: snap.exists ? !!(snap.data() as any)?.isPracticing : true,
      specialties:
        snap.exists && Array.isArray((snap.data() as any)?.specialties)
          ? (snap.data() as any).specialties
          : [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );

  return { ok: true };
});
