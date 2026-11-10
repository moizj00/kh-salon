import type { Failure } from "./types";

// Classifies RPC failures for the outbox (P1-09, NFR-01)
const ACTOR_NOT_READY = ["this device is not approved for this rep", "no active user profile for this session"];
const PERMISSION_DENIED = "42501";
const SQLSTATE_LENGTH = 5;
const SQLSTATE_CLASS_LENGTH = 2;

const PASSING_CLASSES = ["08", "40", "53", "57", "58"];
const HTTP_CLIENT_ERRORS_FROM = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERRORS_FROM = 500;

type Shape = { status: number | null; code: string; message: string };

const shapeOf = (error: unknown): Shape => {
  const e: Record<string, unknown> = typeof error === "object" && error !== null ? { ...error } : {};
  const message = error instanceof Error ? error.message : e.message;
  return {
    status: typeof e.status === "number" ? e.status : null,
    code: typeof e.code === "string" ? e.code : "",
    message: typeof message === "string" ? message : "",
  };
};

const sqlstateOf = (code: string): string => (code.length === SQLSTATE_LENGTH ? code : "");

const answeredAndRefused = (status: number | null): boolean =>
  status !== null &&
  status >= HTTP_CLIENT_ERRORS_FROM &&
  status < HTTP_SERVER_ERRORS_FROM &&
  status !== HTTP_REQUEST_TIMEOUT &&
  status !== HTTP_TOO_MANY_REQUESTS;

export function classifyFailure(error: unknown): Failure {
  const { status, code, message } = shapeOf(error);
  const sqlstate = sqlstateOf(code);
  if (PASSING_CLASSES.includes(sqlstate.slice(0, SQLSTATE_CLASS_LENGTH))) return "transient";
  if (status === HTTP_UNAUTHORIZED) return "auth";
  if (sqlstate === PERMISSION_DENIED && ACTOR_NOT_READY.includes(message)) return "auth";
  if (sqlstate) return "rejected";
  return answeredAndRefused(status) ? "rejected" : "transient";
}

export const failureMessage = (error: unknown): string => shapeOf(error).message.trim() || "The request was refused.";
