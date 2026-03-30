import { useEffect, useMemo, useState } from "react";

function getCountdown(targetISO) {
  const diff = new Date(targetISO).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days:    Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours:   Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

export function CountdownBanner({ data }) {
  const [time, setTime] = useState(() => getCountdown(data.targetISO));

  useEffect(() => {
    const t = setInterval(() => setTime(getCountdown(data.targetISO)), 1000);
    return () => clearInterval(t);
  }, [data.targetISO]);

  const units = useMemo(
    () => [
      { label: "days",    value: time.days },
      { label: "hours",   value: time.hours },
      { label: "minutes", value: time.minutes },
      { label: "seconds", value: time.seconds },
    ],
    [time],
  );

  return (
    <section className="container" data-dp-target-id="countdown">
      <a className="countdown-banner" href={data.ctaHref}>
        <div className="countdown-timer">
          {units.map((u) => (
            <div className="time-chip" key={u.label}>
              <strong>{String(u.value).padStart(2, "0")}</strong>
              <span>{u.label}</span>
            </div>
          ))}
        </div>

        <div className="countdown-copy">
          <p className="eyebrow">Anniversary Sale</p>
          <h2>{data.heading}</h2>
          <p className="muted">{data.body}</p>
        </div>

        <span className="btn btn-primary">{data.ctaText}</span>
      </a>
    </section>
  );
}
