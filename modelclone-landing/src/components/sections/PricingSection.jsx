import { useState } from "react";

function formatPerCredit(value) {
  return Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function getAnnualSavings(monthly, annual) {
  return Math.max(0, monthly * 12 - annual);
}

export function PricingSection({ data }) {
  const [billingCycle, setBillingCycle] = useState(data.billingCycleDefault || "monthly");
  const tiers = data.tiers || [];
  const payg = data.oneTime;
  const signupHref = data.signupHref || "/signup";

  return (
    <section className="container pricing-section" id="pricing">
      {/* Header */}
      <header className="pricing-section-header">
        <h2>{data.title}</h2>
        <div className="pricing-cycle-toggle" role="tablist" aria-label="Billing cycle">
          {["monthly", "annual"].map((cycle) => (
            <button
              type="button"
              key={cycle}
              role="tab"
              aria-selected={billingCycle === cycle}
              className={`pricing-cycle-btn${billingCycle === cycle ? " is-active" : ""}`}
              onClick={() => setBillingCycle(cycle)}
            >
              {cycle === "monthly" ? "Monthly" : "Annual"}
              {cycle === "annual" && billingCycle !== "annual" && (
                <span className="pricing-cycle-badge">−17%</span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Row 1 — subscription tiers (Starter / Pro / Business) */}
      <div className="pricing-cards pricing-tiers-row">
        {tiers.map((tier) => {
          const price = billingCycle === "annual" ? tier.price.annual : tier.price.monthly;
          const savings = getAnnualSavings(tier.price.monthly, tier.price.annual);

          return (
            <article
              key={tier.id}
              className={`pricing-card-glass${tier.popular ? " is-popular" : ""}`}
            >
              {tier.popular && (
                <>
                  <div className="pricing-card-popular-glow" />
                  <div className="pricing-card-top-line" />
                </>
              )}

              <div className="pricing-card-pill-row">
                <span className="pricing-card-pill">{tier.name}</span>
                {tier.popular && (
                  <span className="pricing-card-crown-badge">★ Popular</span>
                )}
              </div>

              <div className="pricing-card-credits-area">
                <p className="pricing-card-credits-value">{tier.credits.toLocaleString()}</p>
                <p className="pricing-card-credits-label">credits / month</p>
                {tier.bonusCredits > 0 && (
                  <span className="pricing-card-bonus">+{tier.bonusCredits.toLocaleString()} bonus</span>
                )}
              </div>

              <div className="pricing-card-price-area">
                <span className="pricing-card-price">${price}</span>
                <span className="pricing-card-per">/{billingCycle === "annual" ? "yr" : "mo"}</span>
              </div>

              <p className="pricing-card-desc">${formatPerCredit(tier.pricePerCredit)}/credit</p>
              {billingCycle === "annual" && savings > 0 && (
                <p className="pricing-card-save">Save ${savings}/year</p>
              )}

              <a
                className={`btn${tier.popular ? " btn-primary" : " btn-ghost"} pricing-card-cta`}
                href={signupHref}
              >
                Get Started
              </a>
            </article>
          );
        })}
      </div>

      {/* Row 2 — Pay As You Go, full-width horizontal card */}
      <div className="pricing-payg-row">
        <article className="pricing-card-glass pricing-card-payg">
          <div className="pricing-payg-inner">
            <div className="pricing-payg-left">
              <span className="pricing-card-pill">Flexible</span>
              <p className="pricing-payg-title">Pay As You Go</p>
              <p className="pricing-card-desc">{payg.description}</p>
            </div>

            <div className="pricing-payg-mid">
              <div className="pricing-card-price-area">
                <span className="pricing-card-price">${formatPerCredit(payg.pricePerCredit)}</span>
                <span className="pricing-card-per">/credit</span>
              </div>
              <p className="pricing-card-desc">No subscription required</p>
            </div>

            <a className="btn btn-ghost pricing-payg-btn" href={signupHref}>Buy Credits</a>
          </div>
        </article>
      </div>

      {/* Footer perks */}
      <div className="pricing-section-perks">
        {["Credits reset monthly", "Bonus credits never expire", "Full commercial rights"].map((t) => (
          <span key={t} className="pricing-perk-chip">{t}</span>
        ))}
      </div>
    </section>
  );
}
