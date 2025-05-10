import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore"
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyD5wzK5eQBS7Fphrsyo82mvfhRjsv7Q9JA",
  authDomain: "milestone-tracker-15187.firebaseapp.com",
  projectId: "milestone-tracker-15187",
  storageBucket: "milestone-tracker-15187.firebasestorage.app",
  messagingSenderId: "365718997648",
  appId: "1:365718997648:web:c241458af8d96660a76615",
  measurementId: "G-TD7HH8V45S"
};

export const app = initializeApp(firebaseConfig);
const db = getFirestore(app)
const storage = getStorage(app)
export const auth = getAuth(app)
connectFirestoreEmulator(db, '127.0.0.1', 8081)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectStorageEmulator(storage, '127.0.0.1', 9199)

