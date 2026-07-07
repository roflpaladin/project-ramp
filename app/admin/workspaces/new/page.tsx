import { createWorkspace } from "./actions";

export default async function NewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main>
      <h1>Create Workspace</h1>
      <form action={createWorkspace}>
        <label>
          Buyer company name
          <input type="text" name="target_company_name" required />
        </label>
        <label>
          Buyer domain
          <input type="text" name="target_domain" placeholder="acme.com" required />
        </label>
        <button type="submit">Create Workspace</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
