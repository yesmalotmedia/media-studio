export const metadata = { title: 'סטודיו שיעורים', description: 'חיתוך ועיבוד שיעורים' };

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{
        margin: 0, background: '#181818', color: '#d4d4d4',
        fontFamily: 'system-ui,-apple-system,"Segoe UI",Arial,sans-serif', minHeight: '100vh',
      }}>{children}</body>
    </html>
  );
}
