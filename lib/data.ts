import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type Specialty = { id: string; name: string; active: boolean };

export type UserRow = {
  uid: string;
  email: string;
  role: string;
  isPracticing?: boolean;
  specialties?: string[];
};

export async function listActiveSpecialties(): Promise<Specialty[]> {
  const snap = await getDocs(collection(db, "specialties"));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((s) => s.active !== false)
    .map((s) => ({ id: s.id, name: s.name ?? "", active: s.active ?? true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Para ASIGNACIÓN DIRECTA: sin restricciones de especialidad
export async function listPracticingUsers(): Promise<UserRow[]> {
  const q = query(collection(db, "users"), where("isPracticing", "==", true));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const data = d.data() as any;
      return {
        uid: d.id,
        email: data.email ?? "",
        role: data.role ?? "",
        isPracticing: data.isPracticing ?? false,
        specialties: data.specialties ?? [],
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}