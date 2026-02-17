"use client";

import { useEffect } from "react";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, firebaseApp } from "@/lib/firebase";

export default function PushNotificationsClient() {
  useEffect(() => {
    async function initPush() {
      try {
        // ⚠️ Solo si hay usuario logueado
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        // 1) Verificar que el navegador soporte service workers
        if (!("serviceWorker" in navigator)) return;

        // 2) Registrar el service worker
        const registration = await navigator.serviceWorker.register(
          "/firebase-messaging-sw.js"
        );

        // 3) Pedir permiso al usuario
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          console.log("Permiso de notificaciones denegado");
          return;
        }

        // 4) Obtener token de FCM
        const messaging = getMessaging(firebaseApp);

        const token = await getToken(messaging, {
          vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: registration,
        });

        if (!token) {
          console.log("No se obtuvo token");
          return;
        }

        console.log("FCM token:", token);

        // 5) Guardar token en Firestore (subcolección del usuario)
        await setDoc(
          doc(db, "users", uid, "fcmTokens", token),
          {
            token,
            createdAt: serverTimestamp(),
            userAgent: navigator.userAgent,
          },
          { merge: true }
        );

        // 6) Manejar notificaciones cuando estás dentro de la app
        onMessage(messaging, (payload) => {
          console.log("Notificación en foreground:", payload);

          if (Notification.permission === "granted") {
            new Notification(
              payload?.notification?.title || "Nueva notificación",
              {
                body: payload?.notification?.body,
              }
            );
          }
        });
      } catch (err) {
        console.error("Error inicializando push", err);
      }
    }

    initPush();
  }, []);

  return null;
}