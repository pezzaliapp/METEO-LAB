# METEO LAB

**Osserva. Interpreta. Simula.**

METEO LAB è una Progressive Web App educativa e sperimentale dedicata alla meteorologia.
Non è un'app meteo tradizionale e non fornisce previsioni: usa dati meteorologici reali come
punto di partenza per osservare, interpretare e sperimentare con un simulatore didattico.

Versione: **0.2.0** · Autore: **Alessandro Pezzali** · Licenza: **MIT**

---

## Visione

```
DATI METEOROLOGICI REALI → OSSERVAZIONE → INTERPRETAZIONE → SIMULAZIONE → APPRENDIMENTO
```

Il dato reale costituisce lo stato iniziale. Entrando in modalità simulazione lo stato atmosferico
viene congelato e usato come condizione iniziale di un modello didattico locale.

## LIVE e SIM

| Indicatore | Significato |
|---|---|
| `● LIVE` | Dato osservato/reale, ricevuto dal provider in questa sessione (meno di 30 minuti fa). |
| `● SIM` | Dato generato dal simulatore didattico. **Non è una previsione meteorologica.** |
| `● OFFLINE` | Nessuna connessione: nessun dato reale aggiornato. |
| `● ULTIMA OSSERVAZIONE` | Dato memorizzato sul dispositivo, con il suo timestamp. Mai presentato come LIVE. |

La distinzione non si affida solo al colore: ogni stato ha un'etichetta testuale, i valori portano
un'etichetta `LIVE` / `SIM` / `ULTIMA`, e la modalità SIM usa bordi tratteggiati e un avviso
permanente «SIMULAZIONE DIDATTICA — NON È UNA PREVISIONE METEOROLOGICA».

## Utilizzo

1. **SCEGLI UN PUNTO SULLA MAPPA** (clic, oppure frecce/zoom da tastiera e «Seleziona centro mappa»).
2. METEO LAB richiede lo stato atmosferico reale: **OSSERVAZIONE ACQUISITA**.
3. Premi **ENTRA NEL LAB**: l'osservazione viene copiata in un `SimulationState` separato (TEMPESTA LAB).
4. Modifica temperatura, umidità e vento: per ogni grandezza sono mostrati valore REALE, SIM e Δ.
5. Premi **AVVIA ESPERIMENTO** e osserva la mappa: **PLAY**, **PAUSA**, **STEP**, **RESET** e i tempi
   T+0 … T+90 cliccabili.
6. **SALVA SCENARIO** conserva lo scenario sul dispositivo; **TORNA AL LIVE** ripristina l'osservazione reale.

## TEMPESTA LAB (0.2)

> **Il radar mostrato in TEMPESTA LAB è una SIMULAZIONE DIDATTICA generata nel browser.
> Non è un'immagine radar reale e NON è una previsione meteorologica.**

**MISSIONE 01 — TEMPESTA.** *Modifica l'atmosfera. Riesci a creare le condizioni per lo sviluppo di un
temporale?*

```
DATI REALI → OSSERVAZIONE → ENTRA NEL LAB → MODIFICA ATMOSFERA → AVVIA ESPERIMENTO
→ (eventuale) NASCITA DELLA CONVEZIONE → EVOLUZIONE SULLA MAPPA → DISSIPAZIONE
```

L'esperimento ha due esiti possibili:

- **NESSUNA CONVEZIONE SIGNIFICATIVA** — con il motivo principale (aria troppo secca, atmosfera stabile,
  inibizione nei bassi strati). Si può modificare l'atmosfera e riprovare.
- **SVILUPPO DEBOLE / CONVEZIONE IN SVILUPPO** — sulla mappa compare il layer **RADAR SIMULATO**:
  la cella nasce, cresce, raggiunge la maturità, si indebolisce e si dissolve, spostandosi con il vento.
  A ogni passo una frase spiega cosa sta accadendo; al termine **ESPERIMENTO COMPLETATO** riassume
  condizioni reali, modifiche, intensità massima, durata e spostamento, con una spiegazione causa-effetto.

### ConvectiveEngine (`src/engine/ConvectiveEngine.ts`)

Modello **didattico**, deterministico (nessun numero casuale), eseguito interamente nel browser.

- **Dati disponibili**: solo grandezze al suolo. Il profilo verticale non è osservato, quindi l'aria in quota
  è un **profilo ipotizzato** (Atmosfera Standard ICAO, −6,5 °C/km fino a 11 km) ancorato alla
  temperatura **reale** al suolo. L'utente modifica solo l'aria vicino al suolo.
- **Ascesa della particella**: adiabatica secca fino alla condensazione (LCL), poi pseudo-adiabatica satura
  (formula AMS Glossary); pressione con l'equazione ipsometrica; vapore con la formula di Magnus.
- **Indici (proxy dichiarati, non valori reali)**: «CAPE didattica», «CIN didattica», Lifted Index a 500 hPa,
  calcolati sul profilo ipotizzato. **Non è la CAPE reale**, che richiederebbe un radiosondaggio o un modello.
- **Nascita della cella**: `stormProbability = f(CAPE) × g(CIN)` con transizioni morbide centrate su soglie
  di letteratura (CAPE 300 J/kg: confine fra convezione debole/assente e marginale; CIN 100 J/kg, con
  200 J/kg «inibizione forte»). La cella nasce se la probabilità interna al modello è ≥ 0,5.
- **Intensità**: corrente ascendente w = ½·√(2·CAPE) (teoria della particella, dimezzata per trascinamento e
  carico d'acqua) → riflettività 25…65 dBZ → pioggia con Marshall–Palmer Z = 200·R^1,6 (limite 53 dBZ).
- **Organizzazione** con lo shear (proxy dal vento): < 10 m/s cella singola, 10–20 m/s multicella,
  > 20 m/s cella organizzata; numero di Richardson di bulk < 10 (Weisman & Klemp, 1982): lo shear
  disperde una corrente ascendente debole.
- **Ciclo di vita** (Byers & Braham, 1949): `NONE → INITIATION → DEVELOPING → MATURE → WEAKENING →
  DISSIPATING`. Innesco a T+15 con inibizione debole (< 50 J/kg), a T+30 altrimenti; fase matura da
  0 (shear eccessivo) a 4 passi (cella organizzata).
- **Movimento**: vento a 10 m esteso a ~1 km con la legge di potenza (esponente 1/7, fattore ≈ 1,93) e
  ruotato di 20° per l'attrito (spirale di Ekman). La cella si sposta verso la direzione in cui soffia il vento,
  a velocità costante: centro(t) = punto scelto + velocità × t.

Uscite: `convectivePotential`, `stormProbability`, `stormIntensity`, `precipitationIntensity`, `cellRadius`,
`cellDirection`, `cellSpeed`, `lifecycleStage` per ogni passo della timeline.

### Radar simulato (`src/engine/SimulatedRadar.ts`)

Nessuna immagine radar reale. Per ogni istante (anche intermedio, per l'animazione) viene generato un campo
di riflettività radiale e disegnato come contorni chiusi a 20 / 35 / 45 / 55 dBZ
(verde → giallo → arancio → rosso). La forma è irregolare grazie ad armoniche angolari con fasi derivate
in modo deterministico dalle condizioni dell'esperimento, allungata lungo il moto, con il nucleo sul fronte
della cella e lobi laterali per multicelle. Sulla mappa il layer è etichettato **RADAR SIMULATO** con la
legenda **SIM RADAR**, ed è mostrata la traiettoria della cella T+0 … T+90.

### Limiti scientifici

- Il profilo verticale è ipotizzato: inversioni, strati secchi in quota e aria fredda in quota reali sono ignorati.
- Niente temperatura virtuale, trascinamento, carico d'acqua nell'ascesa: la CAPE didattica è più alta di
  una CAPE reale con le stesse condizioni al suolo.
- Lo shear è stimato dal solo vento al suolo; la direzione del vento non cambia con la quota oltre ai 20° d'attrito.
- Nessun innesco da orografia, fronti o brezze; nessuna interazione fra celle; la cella non modifica l'ambiente.
- Il riscaldamento diurno simulato dall'AtmosphereEngine non retroagisce sul ConvectiveEngine.

La posizione dell'utente non viene mai richiesta.

## Architettura

```
src/
  models/       AtmosphericState (osservazione reale, immutabile) e SimulationState
  providers/    WeatherProvider astratto + OpenMeteoProvider
  engine/       AtmosphereEngine, ConvectiveEngine, SimulatedRadar (modelli didattici), fisica elementare
  simulation/   timeline T+0 … T+90 (passo 15 minuti) e testi di TEMPESTA LAB
  storage/      IndexedDB: ultima osservazione e scenari salvati
  map/          mappa MapLibre GL (caricata in modo differito)
  components/   interfaccia React
  pwa/          service worker e registrazione
  styles/       CSS
```

Principio fondamentale:

- `AtmosphericState` = osservazione reale. Congelato, mai modificato. I dati mancanti sono `null`.
- `SimulationState` = stato del simulatore. Contiene una copia dell'osservazione come condizione
  iniziale, i parametri scelti dall'utente e la timeline calcolata.

`WeatherProvider` è un'interfaccia: nuove sorgenti (radar, satellite, fulminazioni) potranno essere
aggiunte come nuovi provider senza modificare motore e interfaccia.

### Il modello didattico (AtmosphereEngine)

Non è un modello numerico. Applica poche regole qualitative, dichiarate nel codice e nell'interfaccia:

1. bilancio radiativo diurno/notturno, attenuato dalle nubi;
2. rimescolamento: il vento riduce le variazioni di temperatura;
3. conservazione del vapore: punto di rugiada costante (formula di Magnus);
4. saturazione e condensazione con rilascio di calore latente;
5. formazione/dissipazione delle nubi in funzione dell'umidità, debole precipitazione in saturazione;
6. pressione e direzione del vento invariate.

Se un dato necessario manca nell'osservazione, viene usato un valore didattico dichiarato come «ipotizzato».

## Stack

- React + TypeScript (strict) + Vite
- MapLibre GL JS, tile vettoriali [OpenFreeMap](https://openfreemap.org/) (senza chiave API)
- IndexedDB (API nativa)
- Service Worker scritto a mano, generato in fase di build
- Vitest, ESLint

## Installazione locale

Requisiti: Node.js 22.12+ o 24+ (sviluppato con Node 24).

```bash
npm install
npm run dev        # server di sviluppo
```

## Build

```bash
npm run build      # type check + build di produzione in dist/
npm run preview    # anteprima della build (service worker attivo)
npm test           # test
npm run lint       # ESLint
```

La build è pensata per GitHub Pages e usa il base path `/METEO-LAB/` (asset, manifest e
service worker). `npm run dev` resta alla radice. Per un altro percorso: `BASE_PATH=/altro/ npm run build`.

### Pubblicazione su GitHub Pages

Il workflow `.github/workflows/deploy.yml` esegue `npm ci`, `npm test`, `npm run build` e pubblica
`dist/` con le GitHub Pages Actions ufficiali a ogni push su `main`.
Nelle impostazioni del repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## PWA

- Manifest con nome «METEO LAB», `display: standalone`, icone 192/512 px.
- Il service worker (solo nella build di produzione) mette in cache **solo l'application shell**
  (HTML, JS, CSS, icone della stessa origine).
- Le richieste meteorologiche e le tile della mappa **non** vengono messe in cache dal service worker.
- Offline restano disponibili interfaccia, simulazioni e scenari salvati; l'ultima osservazione
  è mostrata come «ULTIMA OSSERVAZIONE» con il suo timestamp. La mappa richiede la connessione.

## Privacy

- Nessuna registrazione, autenticazione, analytics, pubblicità, fingerprinting o cookie.
- L'unico dato che lascia il dispositivo sono le coordinate del punto selezionato, inviate al
  provider meteorologico (richiesta senza credenziali e senza referrer).
- Osservazioni e scenari restano nell'IndexedDB del browser.
- Le tile della mappa sono scaricate da OpenFreeMap, come per qualunque mappa web.

## Fonti dati

- **Open-Meteo** — Forecast API, blocco `current`
  (`https://api.open-meteo.com/v1/forecast`), documentazione: <https://open-meteo.com/en/docs>.
  Gratuita per uso non commerciale, senza chiave. Dati con licenza CC BY 4.0.
- **Mappa** — OpenFreeMap, © OpenMapTiles, dati © OpenStreetMap contributors.

## Avvertenza

METEO LAB è un progetto educativo e sperimentale. Le simulazioni non costituiscono previsioni
meteorologiche, allerte o indicazioni di sicurezza. Per allerte e informazioni ufficiali fare
sempre riferimento alle autorità competenti.

## Roadmap essenziale

- 0.1 — Osservazione reale puntuale, simulazione didattica di temperatura, umidità e vento. ✔
- 0.2 — TEMPESTA LAB: ConvectiveEngine didattico e radar simulato animato sulla mappa. ✔
- Prossimi passi — nuovi provider (radar, satellite, fulminazioni) sulla stessa architettura;
  nuove missioni; confronto fra simulazione e osservazioni successive.

## Licenza

MIT © 2026 Alessandro Pezzali — vedi [LICENSE](LICENSE).
