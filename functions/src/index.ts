import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import sgMail from "@sendgrid/mail";
import { defineSecret } from "firebase-functions/params";
import ExcelJS from "exceljs";

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const MAIL_FROM = defineSecret("MAIL_FROM");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

admin.initializeApp();

type Jurisdiccion = "nacional" | "federal" | "caba" | "provincia_bs_as";
type AssignmentMode = "auto" | "direct";

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
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

async function assertCaseCreator(caseId: string, uid: string) {
  const caseRef = admin.firestore().collection("cases").doc(caseId);
  const caseSnap = await caseRef.get();
  if (!caseSnap.exists) throw new HttpsError("not-found", "La causa no existe.");

  const c = caseSnap.data() as any;
  const broughtByUid = String(c?.broughtByUid ?? "");
  if (!broughtByUid || broughtByUid !== uid) {
    throw new HttpsError("permission-denied", "Solo quien creó la causa puede hacer esta acción.");
  }

  return { caseRef, caseSnap, caseData: c };
}

function getSendgridConfig() {
  const apiKey = SENDGRID_API_KEY.value();
  const from = MAIL_FROM.value();
  if (!apiKey || !from) return { apiKey: "", from: "" };
  return { apiKey, from };
}

async function sendEmailBestEffort(args: { to: string; subject: string; text: string }) {
  try {
    const { apiKey, from } = getSendgridConfig();
    if (!apiKey || !from) return { sent: false, error: "SendGrid no configurado (faltan secrets)." };

    if (!apiKey.startsWith("SG.")) return { sent: false, error: 'API key does not start with "SG.".' };

    sgMail.setApiKey(apiKey);
    await sgMail.send({ to: args.to, from, subject: args.subject, text: args.text });

    return { sent: true, error: null as string | null };
  } catch (e: any) {
    const err = e?.response?.body ?? e;
    console.error("SendGrid email error:", err);
    return { sent: false, error: e?.message ?? String(e) };
  }
}

async function sendEmailsBestEffort(args: { to: string[]; subject: string; text: string }) {
  try {
    const { apiKey, from } = getSendgridConfig();
    if (!apiKey || !from) return { sent: false, error: "SendGrid no configurado (faltan secrets)." };
    if (!apiKey.startsWith("SG.")) return { sent: false, error: 'API key does not start with "SG.".' };

    const toList = (args.to ?? [])
      .map((x) => String(x || "").trim().toLowerCase())
      .filter((x) => x.includes("@"));

    if (!toList.length) return { sent: false, error: "No hay destinatarios válidos." };

    sgMail.setApiKey(apiKey);

    await sgMail.sendMultiple({
      to: toList,
      from,
      subject: args.subject,
      text: args.text,
    });

    return { sent: true, error: null as string | null };
  } catch (e: any) {
    const err = e?.response?.body ?? e;
    console.error("SendGrid email error:", err);
    return { sent: false, error: e?.message ?? String(e) };
  }
}

/* =========================================================
   PUSH HELPERS (FCM)
   ========================================================= */

async function getUserTokens(uid: string): Promise<string[]> {
  const snap = await admin.firestore().collection(`users/${uid}/fcmTokens`).get();
  return snap.docs.map((d) => d.id);
}

async function notifyUid(uid: string, title: string, body: string, data?: Record<string, string>) {
  const tokens = await getUserTokens(uid);
  if (!tokens.length) return;

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: data ?? {},
  });

  const batch = admin.firestore().batch();
  res.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = (r.error as any)?.code || "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
        batch.delete(admin.firestore().doc(`users/${uid}/fcmTokens/${tokens[idx]}`));
      }
    }
  });
  await batch.commit();
}

/* =========================================================
   CREATE CASE + INVITES
   ========================================================= */

export const createCaseWithInvites = onCall(
  { secrets: [SENDGRID_API_KEY, MAIL_FROM] },
  async (request) => {
    const creatorUid = await assertAuthenticated(request);

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

    // mínimo requerido final
    const requiredAssigneesCount = 2;

    const confirmedAssigneesUids = broughtByParticipates ? [creatorUid] : [];

    let inviteUids: string[] = [];

    if (assignmentMode === "direct") {
      const just = String(data?.directJustification ?? "").trim();
      const direct = uniq(
        (data?.directAssigneesUids ?? [])
          .map((x) => String(x).trim())
          .filter(Boolean)
      );

      const requiredInvites = broughtByParticipates ? 1 : 2;

      if (direct.length < requiredInvites) {
        throw new HttpsError(
          "invalid-argument",
          `Asignación directa requiere al menos ${requiredInvites} invitado(s).`
        );
      }
      if (just.length < 10) {
        throw new HttpsError("invalid-argument", "Justificación obligatoria (mínimo 10 caracteres).");
      }
      if (direct.includes(creatorUid)) {
        throw new HttpsError("invalid-argument", "No podés invitarte a vos mismo.");
      }

      inviteUids = direct;
    } else {
      const needed = requiredAssigneesCount - confirmedAssigneesUids.length;

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
            .filter((u) => u.uid !== creatorUid)
            .sort((a, b) => String(a.email).localeCompare(String(b.email)));

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

    const caseRef = admin.firestore().collection("cases").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const directJustification =
      assignmentMode === "direct" ? String(data?.directJustification ?? "").trim() : "";
    const directAssigneesUids = assignmentMode === "direct" ? inviteUids : [];

    let invitedEmails: string[] = [];

    await admin.firestore().runTransaction(async (tx) => {
      const userRefs = inviteUids.map((u) => admin.firestore().collection("users").doc(u));
      const userSnaps = await Promise.all(userRefs.map((ref) => tx.get(ref)));

      const emailByUid = new Map<string, string>();
      userSnaps.forEach((snap) => {
        const email = snap.exists ? String((snap.data() as any)?.email ?? "") : "";
        emailByUid.set(snap.id, email);
      });

      invitedEmails = inviteUids.map((u) => emailByUid.get(u) ?? "").filter(Boolean);

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
        directAssignmentNeedsReview: false,
        manualReplacementNeeded: false,
        manualReplacementReason: "",
        fallbackReplacementMode: false,
        createdAt: now,
        updatedAt: now,
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

    for (const invitedUid of inviteUids) {
      try {
        await notifyUid(invitedUid, "Nueva invitación", `Te invitaron a una causa: ${caratulaTentativa}`, {
          caseId: caseRef.id,
        });
      } catch (e) {
        console.error("Push invite error:", e);
      }
    }

    const inviteEmailResult = await sendEmailsBestEffort({
      to: invitedEmails,
      subject: `Nueva invitación — ${caratulaTentativa}`,
      text:
        `Tenés una nueva invitación a una causa.\n\n` +
        `Carátula: ${caratulaTentativa}\n` +
        `Jurisdicción: ${jurisdiccion}\n` +
        `CaseId: ${caseRef.id}\n`,
    });

    return {
      caseId: caseRef.id,
      inviteEmailSent: inviteEmailResult.sent,
      inviteEmailError: inviteEmailResult.error,
    };
  }
);

/* =========================================================
   RESPOND INVITE
   - AUTO: mantiene reemplazo automático
   - DIRECT: NO reemplaza automático
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

      let creatorUidToNotify = "";
      let caratulaToNotify = caseId;
      let nextUidToNotify: string | null = null;
      let creatorUidEmail = "";
      let caratulaEmail = caseId;

      await admin.firestore().runTransaction(async (tx) => {
        const [caseSnap, inviteSnap, invitesSnap] = await Promise.all([
          tx.get(caseRef),
          tx.get(inviteRef),
          tx.get(caseRef.collection("invites")),
        ]);

        if (!caseSnap.exists) throw new HttpsError("not-found", "Causa no existe.");
        if (!inviteSnap.exists) throw new HttpsError("not-found", "Invitación no existe.");

        const invite = inviteSnap.data() as any;
        if (String(invite.invitedUid ?? "") !== uid) {
          throw new HttpsError("permission-denied", "No sos el invitado.");
        }
        if (String(invite.status ?? "") !== "pending") {
          throw new HttpsError("failed-precondition", "Invitación ya respondida.");
        }

        const c = caseSnap.data() as any;

        creatorUidToNotify = String(c.broughtByUid ?? "");
        caratulaToNotify = String(c.caratulaTentativa ?? caseId);
        creatorUidEmail = creatorUidToNotify;
        caratulaEmail = caratulaToNotify;

        const assignmentMode: AssignmentMode = (c.assignmentMode ?? "auto") as AssignmentMode;
        const specialtyId: string = String(c.specialtyId ?? "");
        const broughtByUid: string = String(c.broughtByUid ?? "");
        const required: number = Math.max(Number(c.requiredAssigneesCount ?? 2), 2);
        const confirmed: string[] = Array.isArray(c.confirmedAssigneesUids)
          ? uniq(c.confirmedAssigneesUids)
          : [];
        const status: string = String(c.status ?? "draft");
        const directAssignmentNeedsReview = Boolean(c.directAssignmentNeedsReview);
        const fallbackReplacementMode = Boolean(c.fallbackReplacementMode);
        const currentInviteMode = String(invite.mode ?? (assignmentMode === "direct" ? "direct" : "auto"));

        const now = admin.firestore.FieldValue.serverTimestamp();

        const otherInvites = invitesSnap.docs.filter((d) => d.id !== inviteId);
        const otherPendingCount = otherInvites.filter(
          (d) => String((d.data() as any)?.status ?? "") === "pending"
        ).length;

        const newConfirmed =
          decision === "accepted"
            ? uniq([...confirmed, uid])
            : uniq(confirmed);

        // =========================
        // DIRECT
        // =========================
        if (assignmentMode === "direct") {
          if (decision === "accepted") {
            const canAutoAssignDirect =
              otherPendingCount === 0 &&
              !directAssignmentNeedsReview &&
              newConfirmed.length >= 2;

            tx.update(inviteRef, {
              status: decision,
              respondedAt: now,
            });

            tx.update(caseRef, {
              confirmedAssigneesUids: newConfirmed,
              status: canAutoAssignDirect ? "assigned" : "draft",
              updatedAt: now,
            });
            return;
          }

          tx.update(inviteRef, {
            status: decision,
            respondedAt: now,
          });

          tx.update(caseRef, {
            status: "draft",
            directAssignmentNeedsReview: true,
            updatedAt: now,
          });
          return;
        }

        // =========================
        // AUTO + accepted
        // =========================
        if (decision === "accepted") {
          const done = newConfirmed.length >= required;

          tx.update(inviteRef, {
            status: decision,
            respondedAt: now,
          });

          tx.update(caseRef, {
            confirmedAssigneesUids: newConfirmed,
            status: done ? "assigned" : "draft",
            manualReplacementNeeded: false,
            manualReplacementReason: "",
            updatedAt: now,
          });
          return;
        }

        // =========================
        // AUTO + rejected
        // =========================

        // Si ya entró en modo reemplazo manual, no intentar más por especialidad
        if (fallbackReplacementMode || currentInviteMode === "manual_fallback") {
          tx.update(inviteRef, {
            status: decision,
            respondedAt: now,
          });

          tx.update(caseRef, {
            status: "draft",
            manualReplacementNeeded: true,
            manualReplacementReason: "manual_fallback_rejected",
            fallbackReplacementMode: true,
            updatedAt: now,
          });
          return;
        }

        const remainingNeeded = Math.max(0, required - confirmed.length);
        const shouldReplace = status !== "assigned" && remainingNeeded > 0;

        if (!shouldReplace) {
          tx.update(inviteRef, {
            status: decision,
            respondedAt: now,
          });

          tx.update(caseRef, {
            status: "draft",
            updatedAt: now,
          });
          return;
        }

        // Buscar reemplazo SOLO dentro de la especialidad
        const usersQ = admin
          .firestore()
          .collection("users")
          .where("isPracticing", "==", true)
          .where("specialties", "array-contains", specialtyId);

        const usersSnap = await tx.get(usersQ);

        const blocked = new Set<string>([
          ...confirmed,
          ...invitesSnap.docs
            .filter((d) => {
              const inv = d.data() as any;
              const st = String(inv?.status ?? "");
              return st === "pending" || st === "accepted";
            })
            .map((d) => String((d.data() as any)?.invitedUid ?? ""))
            .filter(Boolean),
        ]);

        if (broughtByUid) blocked.add(broughtByUid);
        blocked.add(uid); // no reinvitar al que acaba de rechazar

        const candidates = usersSnap.docs
          .map((d) => ({
            uid: d.id,
            email: String((d.data() as any)?.email ?? ""),
          }))
          .filter((u) => !blocked.has(u.uid))
          .sort((a, b) => a.email.localeCompare(b.email));

        // Si no hay candidatos de la especialidad => pasar a reemplazo manual
        if (candidates.length === 0) {
          tx.update(inviteRef, {
            status: decision,
            respondedAt: now,
          });

          tx.update(caseRef, {
            status: "draft",
            manualReplacementNeeded: true,
            manualReplacementReason: "no_specialty_candidates",
            fallbackReplacementMode: true,
            updatedAt: now,
          });
          return;
        }

        const rotRef = admin.firestore().collection("rotationState").doc(specialtyId);
        const rotSnap = await tx.get(rotRef);
        const cursor = rotSnap.exists ? Number((rotSnap.data() as any)?.cursor ?? 0) : 0;

        const picked = candidates[cursor % candidates.length];
        const nextCursor = (cursor + 1) % candidates.length;

        tx.update(inviteRef, {
          status: decision,
          respondedAt: now,
        });

        const newInviteRef = caseRef.collection("invites").doc();

        tx.set(newInviteRef, {
          invitedUid: picked.uid,
          invitedEmail: picked.email,
          status: "pending",
          invitedAt: now,
          respondedAt: null,
          mode: "auto",
          directJustification: "",
          createdByUid: broughtByUid,
        });

        tx.set(
          rotRef,
          {
            cursor: nextCursor,
            updatedAt: now,
          },
          { merge: true }
        );

        tx.update(caseRef, {
          status: "draft",
          manualReplacementNeeded: false,
          manualReplacementReason: "",
          updatedAt: now,
        });

        nextUidToNotify = picked.uid;
      });

      try {
        if (creatorUidToNotify) {
          await notifyUid(
            creatorUidToNotify,
            `Invitación ${decision === "accepted" ? "aceptada" : "rechazada"}`,
            `Respondieron ${decision} para: ${caratulaToNotify}`,
            { caseId }
          );
        }
      } catch (e) {
        console.error("Push creator error:", e);
      }

      try {
        if (nextUidToNotify) {
          await notifyUid(
            nextUidToNotify,
            "Nueva invitación",
            `Te invitaron a una causa: ${caratulaToNotify}`,
            { caseId }
          );
        }
      } catch (e) {
        console.error("Push reinvite error:", e);
      }

      let creatorEmail = "";
      if (creatorUidEmail) {
        const creatorSnap = await admin.firestore().collection("users").doc(creatorUidEmail).get();
        creatorEmail = String((creatorSnap.data() as any)?.email ?? "");
      }

      let emailSent = false;
      let emailError: string | null = null;

      if (creatorEmail) {
        const decisionLabel = decision === "accepted" ? "ACEPTADA" : "RECHAZADA";
        const r = await sendEmailBestEffort({
          to: creatorEmail,
          subject: `Invitación ${decisionLabel} — ${caratulaEmail}`,
          text:
            `Novedad sobre la causa:\n\n` +
            `Carátula: ${caratulaEmail}\n` +
            `Decisión del invitado: ${decisionLabel}\n` +
            `CaseId: ${caseId}\n`,
        });
        emailSent = r.sent;
        emailError = r.error;
      } else {
        emailSent = false;
        emailError = "El creador no tiene email cargado en users/{uid}.email.";
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

export const inviteCaseReplacement = onCall(
  { secrets: [SENDGRID_API_KEY, MAIL_FROM] },
  async (request) => {
    const uid = await assertAuthenticated(request);

    const data = request.data as {
      caseId?: string;
      newInvitedUid?: string;
      justification?: string;
    };

    const caseId = String(data?.caseId ?? "").trim();
    const newInvitedUid = String(data?.newInvitedUid ?? "").trim();
    const justification = String(data?.justification ?? "").trim();

    if (!caseId) throw new HttpsError("invalid-argument", "Falta caseId.");
    if (!newInvitedUid) throw new HttpsError("invalid-argument", "Falta newInvitedUid.");

    const { caseRef, caseData } = await assertCaseCreator(caseId, uid);

    const assignmentMode = String(caseData?.assignmentMode ?? "") as AssignmentMode;
    const manualReplacementNeeded = Boolean(caseData?.manualReplacementNeeded);
    const fallbackReplacementMode = Boolean(caseData?.fallbackReplacementMode);

    const canUseManualReplacement =
      assignmentMode === "direct" || manualReplacementNeeded || fallbackReplacementMode;

    if (!canUseManualReplacement) {
      throw new HttpsError(
        "failed-precondition",
        "La causa no está en una situación que permita reemplazo manual."
      );
    }

    const creatorUid = String(caseData?.broughtByUid ?? "");
    if (newInvitedUid === creatorUid) {
      throw new HttpsError("invalid-argument", "No podés invitar al creador como reemplazo.");
    }

    await admin.firestore().runTransaction(async (tx) => {
      const [caseSnap, invitesSnap, newUserSnap] = await Promise.all([
        tx.get(caseRef),
        tx.get(caseRef.collection("invites")),
        tx.get(admin.firestore().collection("users").doc(newInvitedUid)),
      ]);

      if (!caseSnap.exists) throw new HttpsError("not-found", "La causa no existe.");
      if (!newUserSnap.exists) throw new HttpsError("not-found", "El abogado seleccionado no existe.");

      const c = caseSnap.data() as any;
      const confirmed = Array.isArray(c?.confirmedAssigneesUids)
        ? uniq(c.confirmedAssigneesUids)
        : [];

      const existingInviteForSameUser = invitesSnap.docs.some((d) => {
        const inv = d.data() as any;
        return String(inv?.invitedUid ?? "") === newInvitedUid;
      });

      if (existingInviteForSameUser || confirmed.includes(newInvitedUid)) {
        throw new HttpsError("already-exists", "Ese abogado ya fue invitado o ya está confirmado.");
      }

      const newInviteRef = caseRef.collection("invites").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const invitedEmail = String((newUserSnap.data() as any)?.email ?? "");

      tx.set(newInviteRef, {
        invitedUid: newInvitedUid,
        invitedEmail,
        status: "pending",
        invitedAt: now,
        respondedAt: null,
        mode: assignmentMode === "direct" ? "direct" : "manual_fallback",
        directJustification: justification || String(c?.directJustification ?? ""),
        createdByUid: uid,
      });

      tx.update(caseRef, {
        status: "draft",
        manualReplacementNeeded: false,
        manualReplacementReason: "",
        fallbackReplacementMode: assignmentMode === "auto" ? true : Boolean(c?.fallbackReplacementMode),
        directAssignmentNeedsReview: assignmentMode === "direct" ? false : Boolean(c?.directAssignmentNeedsReview),
        updatedAt: now,
      });
    });

    try {
      await notifyUid(
        newInvitedUid,
        "Nueva invitación",
        `Te invitaron a una causa: ${String(caseData?.caratulaTentativa ?? caseId)}`,
        { caseId }
      );
    } catch (e) {
      console.error("Push replacement invite error:", e);
    }

    const newUserSnap = await admin.firestore().collection("users").doc(newInvitedUid).get();
    const invitedEmail = String((newUserSnap.data() as any)?.email ?? "");

    let emailSent = false;
    let emailError: string | null = null;

    if (invitedEmail) {
      const r = await sendEmailBestEffort({
        to: invitedEmail,
        subject: `Nueva invitación — ${String(caseData?.caratulaTentativa ?? caseId)}`,
        text:
          `Tenés una nueva invitación a una causa.\n\n` +
          `Carátula: ${String(caseData?.caratulaTentativa ?? caseId)}\n` +
          `Jurisdicción: ${String(caseData?.jurisdiccion ?? "")}\n` +
          `CaseId: ${caseId}\n`,
      });
      emailSent = r.sent;
      emailError = r.error;
    } else {
      emailError = "El reemplazo no tiene email cargado.";
    }

    return { ok: true, emailSent, emailError };
  }
);

/* =========================================================
   DIRECT: INVITAR REEMPLAZO MANUAL
   ========================================================= */

export const inviteDirectReplacement = onCall(
  { secrets: [SENDGRID_API_KEY, MAIL_FROM] },
  async (request) => {
    const uid = await assertAuthenticated(request);

    const data = request.data as {
      caseId?: string;
      newInvitedUid?: string;
      justification?: string;
    };

    const caseId = String(data?.caseId ?? "").trim();
    const newInvitedUid = String(data?.newInvitedUid ?? "").trim();
    const justification = String(data?.justification ?? "").trim();

    if (!caseId) throw new HttpsError("invalid-argument", "Falta caseId.");
    if (!newInvitedUid) throw new HttpsError("invalid-argument", "Falta newInvitedUid.");

    const { caseRef, caseData } = await assertCaseCreator(caseId, uid);

    if (String(caseData?.assignmentMode ?? "") !== "direct") {
      throw new HttpsError("failed-precondition", "Esta acción solo aplica a causas con asignación directa.");
    }

    const creatorUid = String(caseData?.broughtByUid ?? "");
    if (newInvitedUid === creatorUid) {
      throw new HttpsError("invalid-argument", "No podés invitar al creador como reemplazo.");
    }

    const confirmed = Array.isArray(caseData?.confirmedAssigneesUids)
      ? uniq(caseData.confirmedAssigneesUids)
      : [];

    await admin.firestore().runTransaction(async (tx) => {
      const [caseSnap, invitesSnap, newUserSnap] = await Promise.all([
        tx.get(caseRef),
        tx.get(caseRef.collection("invites")),
        tx.get(admin.firestore().collection("users").doc(newInvitedUid)),
      ]);

      if (!caseSnap.exists) throw new HttpsError("not-found", "La causa no existe.");
      if (!newUserSnap.exists) throw new HttpsError("not-found", "El abogado seleccionado no existe.");

      const c = caseSnap.data() as any;
      if (String(c?.assignmentMode ?? "") !== "direct") {
        throw new HttpsError("failed-precondition", "La causa ya no está en modo directo.");
      }

      const existingInviteForSameUser = invitesSnap.docs.some((d) => {
        const inv = d.data() as any;
        return String(inv?.invitedUid ?? "") === newInvitedUid;
      });

      if (existingInviteForSameUser || confirmed.includes(newInvitedUid)) {
        throw new HttpsError("already-exists", "Ese abogado ya fue invitado o ya está confirmado.");
      }

      const newInviteRef = caseRef.collection("invites").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const invitedEmail = String((newUserSnap.data() as any)?.email ?? "");

      tx.set(newInviteRef, {
        invitedUid: newInvitedUid,
        invitedEmail,
        status: "pending",
        invitedAt: now,
        respondedAt: null,
        mode: "direct",
        directJustification: justification || String(c?.directJustification ?? ""),
        createdByUid: uid,
      });

      tx.update(caseRef, {
        status: "draft",
        directAssignmentNeedsReview: false,
        updatedAt: now,
      });
    });

    try {
      await notifyUid(
        newInvitedUid,
        "Nueva invitación",
        `Te invitaron a una causa directa: ${String(caseData?.caratulaTentativa ?? caseId)}`,
        { caseId }
      );
    } catch (e) {
      console.error("Push replacement invite error:", e);
    }

    const newUserSnap = await admin.firestore().collection("users").doc(newInvitedUid).get();
    const invitedEmail = String((newUserSnap.data() as any)?.email ?? "");

    let emailSent = false;
    let emailError: string | null = null;

    if (invitedEmail) {
      const r = await sendEmailBestEffort({
        to: invitedEmail,
        subject: `Nueva invitación — ${String(caseData?.caratulaTentativa ?? caseId)}`,
        text:
          `Tenés una nueva invitación a una causa.\n\n` +
          `Carátula: ${String(caseData?.caratulaTentativa ?? caseId)}\n` +
          `Jurisdicción: ${String(caseData?.jurisdiccion ?? "")}\n` +
          `CaseId: ${caseId}\n`,
      });
      emailSent = r.sent;
      emailError = r.error;
    } else {
      emailError = "El reemplazo no tiene email cargado.";
    }

    return { ok: true, emailSent, emailError };
  }
);

/* =========================================================
   DIRECT: CERRAR ASIGNACIÓN MANUALMENTE
   ========================================================= */

export const finalizeDirectAssignment = onCall(async (request) => {
  const uid = await assertAuthenticated(request);

  const data = request.data as {
    caseId?: string;
  };

  const caseId = String(data?.caseId ?? "").trim();
  if (!caseId) throw new HttpsError("invalid-argument", "Falta caseId.");

  const { caseRef } = await assertCaseCreator(caseId, uid);

  await admin.firestore().runTransaction(async (tx) => {
    const [caseSnap, invitesSnap] = await Promise.all([
      tx.get(caseRef),
      tx.get(caseRef.collection("invites")),
    ]);

    if (!caseSnap.exists) throw new HttpsError("not-found", "La causa no existe.");

    const c = caseSnap.data() as any;
    if (String(c?.assignmentMode ?? "") !== "direct") {
      throw new HttpsError("failed-precondition", "Solo se puede cerrar manualmente una causa con asignación directa.");
    }

    const confirmed = Array.isArray(c?.confirmedAssigneesUids)
      ? uniq(c.confirmedAssigneesUids)
      : [];

    const pendingCount = invitesSnap.docs.filter((d) => {
      const inv = d.data() as any;
      return String(inv?.status ?? "") === "pending";
    }).length;

    if (confirmed.length < 2) {
      throw new HttpsError("failed-precondition", "Se necesitan al menos 2 abogados confirmados.");
    }

    if (pendingCount > 0) {
      throw new HttpsError(
        "failed-precondition",
        "No podés cerrar la asignación mientras haya invitaciones pendientes."
      );
    }

    tx.update(caseRef, {
      status: "assigned",
      directAssignmentNeedsReview: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});

/* =========================================================
   IA: GENERAR INFORME DE CAUSA
   ========================================================= */

export const generateCaseReport = onCall(
  { secrets: [GEMINI_API_KEY] },
  async (request) => {
    const auth = request.auth;

    if (!auth) {
      throw new HttpsError("unauthenticated", "Debés iniciar sesión.");
    }

    const { caseId, kind, tone } = request.data as {
      caseId: string;
      kind?: "cliente" | "interno";
      tone?: "breve" | "detallado";
    };

    if (!caseId) {
      throw new HttpsError("invalid-argument", "Falta caseId.");
    }

    const reportKind = kind === "interno" ? "interno" : "cliente";
    const reportTone = tone === "detallado" ? "detallado" : "breve";

    const db = admin.firestore();

    const caseRef = db.collection("cases").doc(caseId);
    const caseSnap = await caseRef.get();

    if (!caseSnap.exists) {
      throw new HttpsError("not-found", "La causa no existe.");
    }

    const caseData = caseSnap.data() || {};

    const userSnap = await db.collection("users").doc(auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};

    const role = String((userData as any).role || "");
    const assignees = Array.isArray((caseData as any).confirmedAssigneesUids)
      ? ((caseData as any).confirmedAssigneesUids as string[])
      : [];

    const canAccess = role === "admin" || assignees.includes(auth.uid);

    if (!canAccess) {
      throw new HttpsError("permission-denied", "No tenés acceso a esta causa.");
    }

    const metaSnap = await caseRef.collection("management").doc("meta").get();
    const meta = metaSnap.exists ? metaSnap.data() || {} : {};

    const partiesSnap = await caseRef.collection("parties").get();
    const parties = partiesSnap.docs.map((d) => {
      const x = d.data() || {};
      return {
        role: String((x as any).role || ""),
        name: String((x as any).name || ""),
      };
    });

    const logsSnap = await caseRef
      .collection("logs")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const logs = logsSnap.docs
      .map((d) => {
        const x = d.data() || {};
        const createdAt =
          (x as any).createdAt && typeof (x as any).createdAt.toDate === "function"
            ? (x as any).createdAt.toDate().toISOString()
            : null;

        return {
          type: String((x as any).type || ""),
          title: String((x as any).title || ""),
          body: String((x as any).body || ""),
          createdAt,
          createdByEmail: String((x as any).createdByEmail || ""),
        };
      })
      .reverse();

    const safePayload = {
      caratula: String((caseData as any).caratulaTentativa || ""),
      status: String((meta as any).status || ""),
      court: String((meta as any).court || ""),
      fuero: String((meta as any).fuero || ""),
      jurisdiccion: String((meta as any).jurisdiccion || ""),
      deptoJudicial: String((meta as any).deptoJudicial || ""),
      expedienteNumber: String((meta as any).expedienteNumber || ""),
      claimAmount:
        typeof (meta as any).claimAmount === "number" ? (meta as any).claimAmount : null,
      claimAmountDate: String((meta as any).claimAmountDate || ""),
      tribunalAlzada: String((meta as any).tribunalAlzada || ""),
      otherOrganism: String((meta as any).otherOrganism || ""),
      parties,
      logs,
    };

    const systemPrompt =
      reportKind === "cliente"
        ? `
Sos un abogado en Argentina.

Redactá un informe claro, ordenado y profesional para cliente.

Reglas obligatorias:

- usar lenguaje sencillo
- no inventar hechos
- no citar normas ni jurisprudencia salvo que surjan expresamente de los datos
- si falta información, decirlo expresamente
- si la bitácora es escasa, aclararlo

El informe debe incluir estas secciones, en este orden:

1. Carátula y datos básicos
2. Estado actual de la causa
3. Resumen de bitácora
4. Situación actual explicada en términos simples
5. Próximos pasos sugeridos

En "Resumen de bitácora":
- resumir cronológicamente las actuaciones o movimientos relevantes
- no copiar textualmente la bitácora salvo que sea necesario
- sintetizar con claridad y prudencia
- mencionar solo lo verdaderamente relevante

Si la extensión solicitada es "breve":
- hacer párrafos concisos
- no extenderse innecesariamente

Si la extensión solicitada es "detallado":
- desarrollar mejor la evolución de la causa
- ampliar el resumen de bitácora

Terminar exactamente con esta leyenda:

"Borrador generado con asistencia de IA. Requiere revisión profesional antes de su entrega."
`
        : `
Sos un abogado en Argentina.

Redactá un informe interno para estudio jurídico, claro y técnico.

Reglas obligatorias:

- no inventar hechos
- si falta información, decirlo expresamente
- resumir con criterio profesional
- si la bitácora es escasa, aclararlo

El informe debe incluir estas secciones, en este orden:

1. Identificación de la causa
2. Estado procesal actual
3. Resumen de bitácora
4. Evaluación interna breve
5. Próximos pasos / tareas sugeridas

En "Resumen de bitácora":
- resumir cronológicamente los movimientos registrados
- destacar actuaciones relevantes
- evitar repetir innecesariamente textos completos
- mantener precisión sobre lo que surge de los registros

Si la extensión solicitada es "breve":
- ser sintético y directo

Si la extensión solicitada es "detallado":
- ampliar la secuencia de movimientos y su relevancia

Terminar exactamente con esta leyenda:

"Borrador generado con asistencia de IA. Requiere revisión profesional."
`;

    const userPrompt = `
Tipo de informe: ${reportKind}
Extensión: ${reportTone}

Datos de la causa:

${JSON.stringify(safePayload, null, 2)}

Instrucciones adicionales:

- La sección "Resumen de bitácora" debe construirse principalmente a partir del arreglo "logs".
- Los logs ya fueron ordenados cronológicamente del más antiguo al más reciente.
- Si hay varios registros, resumir la evolución de la causa en secuencia temporal.
- Si solo hay pocos registros o son insuficientes, decirlo expresamente.
- Si el tono es "breve", hacer un resumen sintético.
- Si el tono es "detallado", desarrollar mejor la evolución de la bitácora.
- No copiar simplemente el JSON.
- Redactar el informe final en español de Argentina.
`;

    const apiKey = GEMINI_API_KEY.value();

    if (!apiKey) {
      throw new HttpsError("failed-precondition", "Falta GEMINI_API_KEY.");
    }

    const model = "gemini-2.5-flash";
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new HttpsError("internal", err);
    }

    const data = await response.json();

    const report =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => String(p?.text ?? ""))
        .join("\n")
        .trim() || "";

    if (!report) {
      throw new HttpsError("internal", "La IA no devolvió contenido para el informe.");
    }

    return {
      report,
    };
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
  const isPracticing = data?.isPracticing !== false;
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
    { email, role, isPracticing, specialties, createdAt: now, updatedAt: now },
    { merge: true }
  );

  return { ok: true, uid };
});

export const adminUpdateLawyerProfile = onCall(async (request) => {
  await assertAdmin(request);

  const data = request.data as { uid?: string; specialties?: string[]; isPracticing?: boolean };

  const uid = String(data?.uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "Falta uid.");

  const specialties = Array.isArray(data?.specialties) ? data.specialties : [];
  const isPracticing = !!data?.isPracticing;

  await admin.firestore().collection("users").doc(uid).set(
    { specialties, isPracticing, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
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
    for (const u of res.users) if (u.email) users.push({ uid: u.uid, email: u.email.toLowerCase() });
    nextPageToken = res.pageToken;
  } while (nextPageToken);

  users.sort((a, b) => a.email.localeCompare(b.email));
  return { users };
});

export {
  saveMonthlyKpiSnapshot,
  generateKpiSnapshotManual,
  rebuildKpiHistoryManual,
} from "./kpiSnapshots";

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
        snap.exists && Array.isArray((snap.data() as any)?.specialties) ? (snap.data() as any).specialties : [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );

  return { ok: true };
});

export const adminExportCasesExcel = onCall(async (request) => {
  await assertAdmin(request);

  const snap = await admin.firestore().collection("cases").get();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Causas");

  ws.columns = [
    { header: "Carátula", key: "caratula", width: 30 },
    { header: "Especialidad", key: "specialtyId", width: 20 },
    { header: "Jurisdicción", key: "jurisdiccion", width: 15 },
    { header: "Creador", key: "broughtByUid", width: 28 },
    { header: "Participa", key: "participa", width: 10 },
    { header: "Modo", key: "modo", width: 10 },
    { header: "Confirmados", key: "confirmados", width: 30 },
    { header: "Estado", key: "status", width: 12 },
    { header: "Fecha", key: "createdAt", width: 20 },
  ];

  for (const doc of snap.docs) {
    const c = doc.data() as any;

    ws.addRow({
      caratula: c.caratulaTentativa ?? "",
      specialtyId: c.specialtyId ?? "",
      jurisdiccion: c.jurisdiccion ?? "",
      broughtByUid: c.broughtByUid ?? "",
      participa: c.broughtByParticipates ? "Sí" : "No",
      modo: c.assignmentMode ?? "",
      confirmados: (c.confirmedAssigneesUids ?? []).join(", "),
      status: c.status ?? "",
      createdAt: c.createdAt?.toDate?.().toISOString?.() ?? "",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  return { fileName: `causas-${Date.now()}.xlsx`, base64 };
});