// Security review (T43): a URL interpolated into an email's HTML body can be
// derived from request data. A value containing `"` or `<` must not be able
// to break out of an href attribute or inject markup into an email we send
// to a third party, so it is escaped first. Moved here from
// lib/email/templates/access-code.ts in Sprint 12, Ticket 65, when the
// password-reset template became its second caller.
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
