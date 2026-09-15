# Nært Nå — PWA

Web-utgave av Nært Nå. Samme API som appen. Laster **ikke** hele butikken — bare huket by + tema.

## Kjør

Fra `app-dev/nart-na`:

```bash
npm run api
npm run pwa
```

Åpne [http://127.0.0.1:8103](http://127.0.0.1:8103). API: port **8787**.

## Filter

Velg **fylke → kommune** og minst ett tema i **dropdown**. Før det er kart og liste tomme. Identitet i lista ≠ `claimed` (census).

Prikk på kartet åpner et ark: kildelenke + **neste program** (opptil 12 poster). Ingen 1–12t-slider. Tomt = ærlig «ingen bekreftet …», aldri funnet opp visningstid. Kontrakt: [`docs/PIN-SHEET.md`](../docs/PIN-SHEET.md).

## Merke

Arbeidsnavn: **Nært Nå**. 20 alternative navn står i agent-svaret / `#council-nart-na`.
