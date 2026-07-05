import './globals.css';
import { Silkscreen, Anton } from 'next/font/google';

// Silkscreen = the chunky pixel "system font" of the window chrome.
// Anton = the rubber stamp + look names (condensed poster caps, set oblique).
// Body copy runs in Geneva/Verdana — the actual mid-90s Mac screen faces.
const silkscreen = Silkscreen({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-chrome',
});
const anton = Anton({ weight: '400', subsets: ['latin'], variable: '--font-stamp' });

export const metadata = {
  title: 'Outfit From a Vibe — the wardrobe computer',
  description:
    "Cher's outfit-matching computer from Clueless, rebuilt for 2026: type a vibe, get cohesive rentable outfits assembled from Nuuly's closet by a rules engine, not a prompt.",
};

export default function RootLayout({ children }) {
  return (
    // Font variables live on <html>: the :root-level custom properties in
    // globals.css reference them, and var() binds where the property is
    // defined — a body-level class would leave :root pointing at nothing.
    <html lang="en" className={`${silkscreen.variable} ${anton.variable}`}>
      <body>{children}</body>
    </html>
  );
}
