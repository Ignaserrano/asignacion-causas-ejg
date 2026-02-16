import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export async function createCaseWithInvites(params: any) {
  const fn = httpsCallable(functions, "createCaseWithInvites");
  const res = await fn(params);
  return res.data as { caseId: string };
}

export async function respondInvite(params: {
  caseId: string;
  inviteId: string;
  decision: "accepted" | "rejected";
}) {
  const fn = httpsCallable(functions, "respondInvite");
  const res = await fn(params);
  return res.data as { ok: boolean };
}