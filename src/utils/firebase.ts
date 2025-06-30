import firebase from 'firebase/app';
import 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

export function initializeFirebase() {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
}

export async function getSubjects(): Promise<string[]> {
  const snapshot = await firebase.database().ref('Subjects').once('value');
  return Object.keys(snapshot.val() || {});
}

export async function getChapters(subject: string): Promise<string[]> {
  const snapshot = await firebase.database().ref(`Subjects/${subject}`).once('value');
  return Object.keys(snapshot.val() || {});
}

export async function getContent(subject: string, chapter: string, contentType: string): Promise<Record<string, string>> {
  const snapshot = await firebase.database().ref(`Subjects/${subject}/${chapter}/${contentType}`).once('value');
  return snapshot.val() || {};
}

export async function saveContent(subject: string, chapter: string, contentType: string, messageIds: Record<string, string>) {
  await firebase.database().ref(`Subjects/${subject}/${chapter}/${contentType}`).set(messageIds);
}

export async function checkAccess(userId: string): Promise<boolean> {
  const snapshot = await firebase.database().ref(`Users/${userId}/access_expiry`).once('value');
  const expiry = snapshot.val();
  if (!expiry) return false;
  return new Date(expiry) > new Date();
}

export async function saveToken(token: string, userId: string, username: string) {
  await firebase.database().ref(`Tokens/${token}`).set({
    used: false,
    userid: userId,
    username
  });
}
