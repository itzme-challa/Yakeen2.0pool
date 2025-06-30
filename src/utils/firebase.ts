import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, query, orderByChild, equalTo } from 'firebase/database';

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
  initializeApp(firebaseConfig);
}

export async function getSubjects(): Promise<string[]> {
  const db = getDatabase();
  const snapshot = await get(ref(db, 'Subjects'));
  return Object.keys(snapshot.val() || {});
}

export async function getChapters(subject: string): Promise<string[]> {
  const db = getDatabase();
  const snapshot = await get(ref(db, `Subjects/${subject}`));
  return Object.keys(snapshot.val() || {});
}

export async function getContent(subject: string, chapter: string, contentType: string): Promise<Record<string, string>> {
  const db = getDatabase();
  const snapshot = await get(ref(db, `Subjects/${subject}/${chapter}/${contentType}`));
  return snapshot.val() || {};
}

export async function saveContent(subject: string, chapter: string, contentType: string, messageIds: Record<string, string>) {
  const db = getDatabase();
  await set(ref(db, `Subjects/${subject}/${chapter}/${contentType}`), messageIds);
}

export async function checkAccess(userId: string): Promise<boolean> {
  const db = getDatabase();
  const snapshot = await get(ref(db, `Users/${userId}/access_expiry`));
  const expiry = snapshot.val();
  if (!expiry) return false;
  return new Date(expiry) > new Date();
}

export async function saveToken(token: string, userId: string, username: string) {
  const db = getDatabase();
  const date = token.split('-')[3]; // Extract DDMMYYYY from token
  await set(ref(db, `Tokens/${token}`), {
    used: false,
    userid: userId,
    username,
    date
  });
}

export async function checkToken(token: string): Promise<{ used: boolean; userid: string; username: string; date: string } | null> {
  const db = getDatabase();
  const snapshot = await get(ref(db, `Tokens/${token}`));
  return snapshot.val() || null;
}

export async function findExistingToken(userId: string, date: string): Promise<string | null> {
  const db = getDatabase();
  const tokensRef = query(
    ref(db, 'Tokens'),
    orderByChild('userid'),
    equalTo(userId)
  );
  const snapshot = await get(tokensRef);
  const tokens = snapshot.val();
  if (!tokens) return null;
  for (const token in tokens) {
    if (tokens[token].date === date && !tokens[token].used) {
      return token;
    }
  }
  return null;
}

export async function generateToken(userId: string): Promise<string> {
  const date = new Date().toLocaleDateString('en-GB').replace(/\//g, ''); // DDMMYYYY
  const randomId = Math.random().toString(36).substring(2, 8); // 6-char random ID
  return `Token-${userId}-${randomId}-${date}`;
}

export async function grantAccess(userId: string, username: string, token: string) {
  const db = getDatabase();
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 24);
  await set(ref(db, `Users/${userId}`), {
    username,
    access_expiry: expiry.toISOString()
  });
  await set(ref(db, `Tokens/${token}/used`), true);
}
