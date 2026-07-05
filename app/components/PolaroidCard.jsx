// One garment as an instant photo: image, slot sticker, brand/title caption,
// retail value, and the all-important "Rent →" link back to Nuuly.
const SLOT_LABELS = {
  top: 'top',
  bottom: 'bottom',
  dress: 'dress',
  onepiece: 'one-piece',
  outerwear: 'outerwear',
  layer: 'layer',
};

export default function PolaroidCard({ item, tilt = 0 }) {
  return (
    <figure className="polaroid" style={{ '--tilt': `${tilt}deg` }}>
      <span className="slot-tag">{SLOT_LABELS[item.slot] ?? item.slot}</span>
      <img
        src={`${item.image}?wid=360&fit=constrain`}
        alt={`${item.title}${item.brand ? ` by ${item.brand}` : ''}`}
        loading="lazy"
      />
      <figcaption>
        <span className="brand">{item.brand ?? '—'}</span>
        <span className="item-title" title={item.title}>
          {item.title}
        </span>
        <span className="buy-row">
          <span className="retail">{item.retail ? `$${item.retail} retail` : ''}</span>
          <a className="rent" href={item.url} target="_blank" rel="noopener noreferrer">
            Rent&nbsp;→
          </a>
        </span>
      </figcaption>
    </figure>
  );
}
