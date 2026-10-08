// A pinned-up One Direction poster for the home page's "Boy band edition!" theme, with heart
// emojis floating up out of it. The image lives at public/one-direction.jpg.

const POSTER_SRC = '/one-direction.jpg';

// Each heart's start position (across the poster), drift, size and timing.
const HEARTS = [
  { e: '💖', x: '18%', dx: '-26px', rot: '-18deg', size: '1.15rem', dur: '4.2s', delay: '0s' },
  { e: '💕', x: '48%', dx: '14px', rot: '12deg', size: '1rem', dur: '3.6s', delay: '0.7s' },
  { e: '💘', x: '78%', dx: '38px', rot: '22deg', size: '1.3rem', dur: '4.6s', delay: '1.4s' },
  { e: '💗', x: '30%', dx: '-8px', rot: '-8deg', size: '0.95rem', dur: '3.9s', delay: '2.1s' },
  { e: '❤️', x: '64%', dx: '24px', rot: '16deg', size: '1.1rem', dur: '4.4s', delay: '2.8s' },
  { e: '💜', x: '8%', dx: '-34px', rot: '-24deg', size: '1rem', dur: '4.8s', delay: '3.4s' },
  { e: '💞', x: '88%', dx: '46px', rot: '28deg', size: '1.05rem', dur: '4s', delay: '1s' },
  { e: '💓', x: '56%', dx: '2px', rot: '4deg', size: '1.2rem', dur: '5s', delay: '3.9s' },
];

export default function BoyBandPoster() {
  return (
    <div className="bb-poster">
      <div className="bb-hearts" aria-hidden="true">
        {HEARTS.map((h, i) => (
          <span key={i} className="bb-heart" style={{
            '--x': h.x, '--dx': h.dx, '--rot': h.rot, '--size': h.size, '--dur': h.dur, '--delay': h.delay,
          } as React.CSSProperties}>{h.e}</span>
        ))}
      </div>
      <div className="bb-poster-paper">
        <span className="bb-pin" aria-hidden="true" />
        <img src={POSTER_SRC} alt="One Direction poster" className="block aspect-[3/4] w-full object-cover" />
      </div>
    </div>
  );
}
