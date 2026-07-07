import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function AdminHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main>
      <h1>Admin</h1>
      <p>Signed in as {user?.email}</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
      <p>Workspace builder placeholder — built out in the next ticket.</p>
    </main>
  );
}
