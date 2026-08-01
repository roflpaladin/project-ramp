// Extracts the RSC flight payload — the `self.__next_f.push([...])` calls the
// App Router inlines into <script> tags — separately from the rest of the HTML.
//
// THE BUG THIS EXISTS TO CATCH: props passed to a Client Component are
// serialized into this payload and shipped to the browser even when the
// component never renders them. `{isSeller && <Strip crm={crm} />}` leaves
// crm_amount sitting in page source outside anywhere a DOM parser would ever
// look. A test that only inspects the parsed/rendered DOM would pass while the
// data is fully exposed in view-source. Grepping raw HTML catches this too
// (the flight script is part of the HTML), but extracting it in isolation
// proves the leak lives specifically in the mechanism Ticket 26 names, not
// merely "somewhere in the response" — and keeps the assertion meaningful even
// if a future refactor moves other content around the flight scripts.

const FLIGHT_PUSH_PATTERN = /self\.__next_f\.push\((\[[\s\S]*?\])\)/g;

/**
 * Returns the concatenated contents of every `self.__next_f.push([...])` call
 * found in `html`, or an empty string if none are present (e.g. a fully static
 * page with no client-component boundary).
 */
export function extractRscFlightPayload(html: string): string {
  const matches = [...html.matchAll(FLIGHT_PUSH_PATTERN)];
  return matches.map((match) => match[1]).join("\n");
}
