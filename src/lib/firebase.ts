// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
  deleteDoc,
  type Firestore, // <- type-only
} from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";

// Cole aqui seu config do Console (o seu já está ok)
const firebaseConfig = {
  apiKey: "AIzaSyAhvQgijS9yI9sXVUTYEc0439b-jP36uDs",
  authDomain: "egx-schedule.firebaseapp.com",
  projectId: "egx-schedule",
  storageBucket: "egx-schedule.firebasestorage.app",
  messagingSenderId: "59881206097",
  appId: "1:59881206097:web:e7b2a2fcd84e4107c3e370",
  measurementId: "G-C6HVRSTYFZ",
};

const app = initializeApp(firebaseConfig);

// Firestore com cache offline + fallback de rede (compatível com v12)
export const db: Firestore = initializeFirestore(app, {
  // cache offline persistente e suporte multi-abas
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  // força long-polling quando WebSockets/HTTP2 dão problema (rede restrita)
  experimentalForceLongPolling: true,
  // ❌ useFetchStreams foi removido nas versões recentes — não usar aqui
});

// Auth (login e observador de sessão)
export const auth = getAuth(app);
export function watchUser(cb: (u: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}
export async function emailPasswordSignIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}
export async function signOutApp() {
  return signOut(auth);
}

// CRUD de dias
export async function saveDayToCloud(entry: {
  date: string; amScheduled: string[]; amOff: string[];
  pmScheduled: string[]; pmOff: string[];
}) {
  await setDoc(doc(db, "days", entry.date), entry, { merge: true });
}

export async function fetchDaysBetween(start: string, end: string) {
  const col = collection(db, "days");
  const q = query(col, where("date", ">=", start), where("date", "<=", end));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as any);
}

export async function deleteDay(date: string) {
  await deleteDoc(doc(db, "days", date));
}
export async function deleteDays(dates: string[]) {
  for (const dt of dates) await deleteDay(dt);
}
