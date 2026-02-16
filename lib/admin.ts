import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export async function createLawyer(params: {
  email: string;
  password: string;
  specialties: string[];
}) {
  const fn = httpsCallable(functions, "createLawyer");
  const res = await fn(params);
  return res.data as { uid: string };
}