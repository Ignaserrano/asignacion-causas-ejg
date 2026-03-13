import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type KpiTarget = {
  revenueTarget?: number;
  studioFundTarget?: number;
  newCasesTarget?: number;
};

export function kpiTargetRef(periodKey: string) {
  return doc(db, "kpi_targets", periodKey);
}

export async function getKpiTarget(periodKey: string): Promise<KpiTarget | null> {
  const snap = await getDoc(kpiTargetRef(periodKey));
  if (!snap.exists()) return null;
  return snap.data() as KpiTarget;
}

export async function saveKpiTarget(periodKey: string, data: KpiTarget) {
  await setDoc(kpiTargetRef(periodKey), data, { merge: true });
}