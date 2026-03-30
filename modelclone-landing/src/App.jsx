import { PromoBar }          from "./components/sections/PromoBar";
import { Navbar }            from "./components/sections/Navbar";
import { HeroSlider }        from "./components/sections/HeroSlider";
import { CountdownBanner }   from "./components/sections/CountdownBanner";
import { CreateTodaySection } from "./components/sections/CreateTodaySection";
import { TopChoiceSection }  from "./components/sections/TopChoiceSection";
import { PartnersSection }   from "./components/sections/PartnersSection";
import { PricingSection }    from "./components/sections/PricingSection";
import { landingConfig }     from "./config/landing.config";
import { CustomCursor }      from "./components/CustomCursor";

function App() {
  const { brand, promotionBar, hero, countdown, createToday, topChoice, partners, pricing, footerCta } =
    landingConfig;

  return (
    <div className="page">
      <div className="legacy-grid-bg" aria-hidden="true" />
      <CustomCursor />
      <div className="site-header-shell">
        {promotionBar.enabled && <PromoBar data={promotionBar} />}
        <Navbar brand={brand} />
      </div>

      <main id="main">
        {hero.enabled        && <HeroSlider       data={hero}        />}
        {countdown.enabled   && <CountdownBanner  data={countdown}   />}
        {createToday.enabled && <CreateTodaySection data={createToday} />}
        {topChoice.enabled   && <TopChoiceSection  data={topChoice}   />}
        {partners.enabled    && <PartnersSection   data={partners}    />}
        {pricing.enabled     && <PricingSection    data={pricing}     />}
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <p>{footerCta.text}</p>
          <a href={footerCta.ctaHref} className="btn btn-primary">
            {footerCta.ctaText}
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
