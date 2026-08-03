import { NextResponse } from "next/server";

import { getPlanForSeller } from "@/lib/plans/queries";
import { createClient } from "@/lib/supabase/server";

// T28-11 (Sprint 6, Ticket 28; plans/sprint-6-7-replan.md §6, decision 2).
// GET only — the mutation surface is the "use server" actions in
// app/admin/workspaces/[id]/plan/plan-actions.ts (T28-10), not this route.
// Its real consumer is Ticket 36's dashboard poller.
//
// Never imports the admin client: this is the seller (AE) read path, RLS-
// scoped exactly like the /admin/workspaces/[id] page.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ws: string }> },
): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 401 BEFORE touching params, deliberately. An RLS-scoped anon query
  // against a real workspace id returns an empty row set, not an error — so
  // checking auth first and independently of whatever `ws` resolves to is
  // what keeps an unauthenticated request from getting a 200-with-nothing,
  // which is itself a weak enumeration signal (confirms "no plan" rather
  // than "you're not allowed to ask").
  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { ws } = await params;
  const plan = await getPlanForSeller(ws, supabase);

  if (!plan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: plan }, { headers: { "Cache-Control": "no-store" } });
}
