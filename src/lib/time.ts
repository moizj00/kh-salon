// Times on the page (REP-20, L2). The database keeps timestamps in UTC and its dates are Karachi dates.
export const KARACHI = "Asia/Karachi";

/** A database time as a short Karachi date and time, e.g. "06-Nov-2026, 1:00 am". */
export const when = (t: string | number) => {
  try {
    return new Date(t).toLocaleString("en-PK", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: KARACHI,
    });
  } catch {
    return new Date(t).toLocaleString();
  }
};

/** Like `when`, for a time that may be missing: a dash when there is none. */
export const whenOrDash = (t: string | number | null | undefined) => (t ? when(t) : "—");

/** A database time as a short Karachi clock time only, e.g. "1:00 am". */
export const clock = (t: string | number) => {
  try {
    return new Date(t).toLocaleTimeString("en-PK", {
      timeStyle: "short",
      timeZone: KARACHI,
    });
  } catch {
    return new Date(t).toLocaleTimeString();
  }
};
