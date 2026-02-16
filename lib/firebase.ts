import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCHI-A19ACPDL8bymMEngydwU8M37DvU34",
  authDomain: "asignacion-causas-egj.firebaseapp.com",
  projectId: "asignacion-causas-egj",
  storageBucket: "asignacion-causas-egj.firebasestorage.app",
  messagingSenderId: "275615243127",
  appId: "1:275615243127:web:98df2703f024241aaf1f72"
};


const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);