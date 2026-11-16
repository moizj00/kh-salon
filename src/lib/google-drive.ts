import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.activity",
  "https://www.googleapis.com/auth/drive.activity.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.apps.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.install",
  "https://www.googleapis.com/auth/drive.meet.readonly",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.photos.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.scripts",
] as const;

let cachedAccessToken: string | null = null;
let isSigningIn = false;

function getFirebaseAppInstance(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

function getFirebaseAuthInstance(): Auth {
  return getAuth(getFirebaseAppInstance());
}

function buildGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_DRIVE_SCOPES) {
    provider.addScope(scope);
  }
  return provider;
}

export function initGoogleDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
): () => void {
  const auth = getFirebaseAuthInstance();
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function signInWithGoogleDrive(): Promise<{ user: User; accessToken: string }> {
  const auth = getFirebaseAuthInstance();
  const provider = buildGoogleProvider();
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Google Drive access token was not returned by Google Sign-In.");
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogleDrive(): Promise<void> {
  const auth = getFirebaseAuthInstance();
  await signOut(auth);
  cachedAccessToken = null;
}

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export async function listGoogleDriveReports(
  accessToken: string,
  pageSize = 8,
): Promise<DriveFileSummary[]> {
  const query = encodeURIComponent("trashed = false and name contains 'kiran-'");
  const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink)");
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=${pageSize}&orderBy=modifiedTime%20desc&fields=${fields}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive list error (${res.status}): ${text || res.statusText}`);
  }
  const data = (await res.json()) as { files?: DriveFileSummary[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function uploadCsvToGoogleDrive(
  accessToken: string,
  filename: string,
  csvContent: string,
): Promise<DriveFileSummary> {
  const metadata = {
    name: filename,
    mimeType: "text/csv",
  };
  const boundary = `kiran_drive_${Date.now()}`;
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/csv; charset=UTF-8\r\n\r\n` +
    `${csvContent}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive upload error (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as DriveFileSummary;
}
