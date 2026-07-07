export default async function PortalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main>
      <h1>Deal Room</h1>
      <p>Workspace: {id}</p>
    </main>
  );
}
