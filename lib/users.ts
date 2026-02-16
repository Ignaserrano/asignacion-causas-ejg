import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type UserRole = "admin" | "abogado";

export type AppUser = {
  email: string;
  role: UserRole;
  createdAt?: any;
};

export async function getUserProfile(uid: string): Promise<AppUser | null> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as AppUser;
}