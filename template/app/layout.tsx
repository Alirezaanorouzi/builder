export const metadata = {
  title: "Care Clinic",
  description: "Your local clinic",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#1a1a1a" }}>
        {children}
      </body>
    </html>
  );
}
