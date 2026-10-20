import { test, expect } from "@playwright/test";
import { parsePage } from "../src/parse/parser";

test.describe("parser module", () => {
  test("parses basic page information and schema.org JSON-LD", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="description" content="Find out about paracetamol, including dosages." />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "drug": {
                "proprietaryName": ["Panadol", "Calpol"],
                "nonProprietaryName": "Paracetamol"
              },
              "lastReviewed": ["2023-01-15"]
            }
          </script>
        </head>
        <body>
          <main>
            <h1>Paracetamol <span class="nhsuk-caption-xl">- Brand name: Panadol</span></h1>
            <p class="nhsuk-lede-text">Paracetamol is a common painkiller.</p>
            <article>
              <section id="about">
                <h2>1. About paracetamol</h2>
                <p>It is used to treat aches and pain.</p>
                <ul>
                  <li>Headaches</li>
                  <li>Fever</li>
                </ul>
              </section>
            </article>
          </main>
        </body>
      </html>
    `;

    const parsed = parsePage(html);

    expect(parsed.title).toBe("Paracetamol");
    expect(parsed.genericName).toBe("Paracetamol");
    expect(parsed.brandNames).toEqual(["Panadol", "Calpol"]);
    expect(parsed.lastReviewed).toBe("2023-01-15");
    expect(parsed.summary).toBe("Paracetamol is a common painkiller.");
    expect(parsed.discontinued).toBe(false);
    expect(parsed.sections).toHaveLength(1);

    const section = parsed.sections[0];
    expect(section.id).toBe("about");
    expect(section.heading).toBe("About paracetamol");
    expect(section.content).toEqual([
      { type: "paragraph", text: "It is used to treat aches and pain." },
      { type: "list", items: ["Headaches", "Fever"] },
    ]);
  });

  test("parses care cards and emergency callouts", () => {
    const html = `
      <main>
        <h1>Emergency Test</h1>
        <article>
          <section id="side-effects">
            <h2>Side effects</h2>
            <div class="nhsuk-card nhsuk-card--care nhsuk-card--care--emergency">
              <h3 class="nhsuk-card__heading">Call 999 immediately</h3>
              <div class="nhsuk-card__content">
                <p>If you experience sudden swelling of the lips or throat.</p>
              </div>
            </div>
            <p>Common side effects are mild.</p>
          </section>
        </article>
      </main>
    `;

    const parsed = parsePage(html);
    expect(parsed.sections).toHaveLength(1);

    const section = parsed.sections[0];
    expect(section.callouts).toHaveLength(1);
    expect(section.callouts[0]).toEqual({
      level: "emergency",
      heading: "Call 999 immediately",
      content: [
        {
          type: "paragraph",
          text: "If you experience sudden swelling of the lips or throat.",
        },
      ],
    });
    expect(section.content).toEqual([
      { type: "paragraph", text: "Common side effects are mild." },
    ]);
  });

  test("detects discontinued medicines from meta description", () => {
    const html = `
      <head>
        <meta name="description" content="This medicine has been discontinued in the UK." />
      </head>
      <main>
        <h1>Discontinued Drug</h1>
      </main>
    `;

    const parsed = parsePage(html);
    expect(parsed.discontinued).toBe(true);
  });

  test("extracts topic name from bottom caption on guide-style pages", () => {
    const html = `
      <main>
        <h1>
          <span role="text">Overview
            <span class="nhsuk-caption-xl nhsuk-caption--bottom">
              <span class="nhsuk-u-visually-hidden"> - </span>
              Antibiotics
            </span>
          </span>
        </h1>
      </main>
    `;

    const parsed = parsePage(html);
    expect(parsed.title).toBe("Antibiotics");
  });
});

