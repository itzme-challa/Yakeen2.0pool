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
  try {
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    return db;
  } catch (error: unknown) {
    console.error('Firebase initialization error:', error);
    throw new Error('Failed to initialize Firebase');
  }
}

export async function getSubjects(): Promise<string[]> {
  try {
    const db = initializeFirebase();
    const snapshot = await get(ref(db, 'Subjects'));
    const subjects = snapshot.val();
    return subjects ? Object.keys(subjects) : [];
  } catch (error: unknown) {
    console.error('Error fetching subjects:', error);
    throw new Error('Failed to fetch subjects');
  }
}

export async function getChapters(subject: string): Promise<string[]> {
  try {
    const db = initializeFirebase();
    const snapshot = await get(ref(db, `Subjects/${subject}`));
    const chapters = snapshot.val();
    return chapters ? Object.keys(chapters) : [];
  } catch (error: unknown) {
    console.error(`Error fetching chapters for subject ${subject}:`, error);
    throw new Error('Failed to fetch chapters');
  }
}

export async function getContent(subject: string, chapter: string, contentType: string): Promise<Record<string, string>> {
  try {
    const db = initializeFirebase();
    const snapshot = await get(ref(db, `Subjects/${subject}/${chapter}/${contentType}`));
    return snapshot.val() || {};
  } catch (error: unknown) {
    console.error(`Error fetching content for ${subject}/${chapter}/${contentType}:`, error);
    throw new Error('Failed to fetch content');
  }
}

export async function saveContent(subject: string, chapter: string, contentType: string, messageIds: Record<string, string>, userId: string) {
  try {
    const db = initializeFirebase();
    const adminSnapshot = await get(ref(db, `Users/${userId}/isAdmin`));
    if (!adminSnapshot.val()) throw new Error('Unauthorized: Admin access required');
    await set(ref(db, `Subjects/${subject}/${chapter}/${contentType}`), messageIds);
  } catch (error: unknown) {
    console.error(`Error saving content for ${subject}/${chapter}/${contentType}:`, error);
    throw error;
  }
}

export async function checkAccess(userId: string): Promise<boolean> {
  try {
    const db = initializeFirebase();
    const snapshot = await get(ref(db, `Users/${userId}/access_expiry`));
    const expiry = snapshot.val();
    if (!expiry) return false;
    return new Date(expiry) > new Date();
  } catch (error: unknown) {
    console.error(`Error checking access for user ${userId}:`, error);
    throw new Error('Failed to check access');
  }
}

export async function saveToken(token: string, userId: string, username: string, shortLink?: string) {
  try {
    const db = initializeFirebase();
    await set(ref(db, `Tokens/${token}`), {
      used: false,
      userid: userId,
      username,
      createdAt: Date.now(),
      shortLink: shortLink || null
    });
  } catch (error: unknown) {
    console.error(`Error saving token ${token} for user ${userId}:`, error);
    throw new Error('Failed to save token');
  }
}

export async function checkToken(token: string): Promise<{ used: boolean; userid: string; username: string; createdAt: number; shortLink?: string } | null> {
  try {
    const db = initializeFirebase();
    const snapshot = await get(ref(db, `Tokens/${token}`));
    return snapshot.val() || null;
  } catch (error: unknown) {
    console.error(`Error checking token ${token}:`, error);
    throw new Error('Failed to check token');
  }
}

export async function generateToken(userId: string): Promise<string> {
  try {
    const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '');
    const randomId = Math.random().toString(36).substring(2, 8);
    return `Token-${userId}-${date}-${randomId}`;
  } catch (error: unknown) {
    console.error(`Error generating token for user ${userId}:`, error);
    throw new Error('Failed to generate token');
  }
}

export async function grantAccess(userId: string, username: string, token: string) {
  try {
    const db = initializeFirebase();
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);
    await set(ref(db, `Users/${userId}`), {
      userid: userId,
      username,
      access_expiry: expiry.toISOString()
    });
    await set(ref(db, `Tokens/${token}/used`), true);
  } catch (error: unknown) {
    console.error(`Error granting access for user ${userId} with token ${token}:`, error);
    throw new Error('Failed to grant access');
  }
}

export async function getUnusedToken(userId: string): Promise<{ token: string; createdAt: number; shortLink?: string } | null> {
  try {
    const db = initializeFirebase();
    const tokensRef = query(ref(db, 'Tokens'), orderByChild('userid'), equalTo(userId));
    const snapshot = await get(tokensRef);
    const tokens = snapshot.val();
    if (!tokens) return null;

    for (const [token, data] of Object.entries(tokens) as [string, { used: boolean; userid: string; username: string; createdAt: number; shortLink?: string }][]) {
      if (!data.used && data.userid === userId) {
        return { token, createdAt: data.createdAt, shortLink: data.shortLink };
      }
    }
    return null;
  } catch (error: unknown) {
    console.error(`Error fetching unused token for user ${userId}:`, error);
    throw new Error('Failed to fetch unused token');
  }
}
