import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type GenerateCaseReportParams = {
  caseId: string;
  kind: "cliente" | "interno";
  tone: "breve" | "detallado";
};

export async function generateCaseReport(params: GenerateCaseReportParams) {
  const fn = httpsCallable(functions, "generateCaseReport");
  const res: any = await fn(params);

  return {
    report: String(res?.data?.report ?? ""),
  };
}