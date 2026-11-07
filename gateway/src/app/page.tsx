export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Cursor agent gateway</h1>
      <p>Proxy only. Call POST/GET /api/cursor/v1/... with Authorization: Bearer.</p>
    </main>
  );
}
