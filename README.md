# METEO LAB

**Osserva. Interpreta. Simula.**

METEO LAB è una Progressive Web App educativa e sperimentale dedicata alla meteorologia.
Non è un'app meteo tradizionale e non fornisce previsioni: usa dati meteorologici reali come
punto di partenza per osservare, interpretare e sperimentare con un simulatore didattico.

Versione: **0.4.0** · Autore: **Alessandro Pezzali** · Licenza: **MIT**

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
2. METEO LAB richiede lo stato atmosferico al suolo e il **PROFILO ATMOSFERICO**: **OSSERVAZIONE ACQUISITA**.
   Il comando **PROFILO** mostra la sezione verticale (quota, temperatura, punto di rugiada, vento).
3. Premi **ENTRA NEL LAB**: l'osservazione viene copiata in un `SimulationState` separato (TEMPESTA LAB).
4. Scegli la missione (01 TEMPESTA, 02 GRANDINE, 03 DOWNBURST) e modifica temperatura, umidità e vento
   al suolo: per ogni grandezza sono mostrati valore REALE, SIM e Δ. Il profilo in quota resta quello reale.
5. Premi **AVVIA ESPERIMENTO** e osserva la mappa: **PLAY**, **PAUSA**, **STEP**, **RESET** e i tempi
   T+0 … T+90 cliccabili.
6. **SALVA SCENARIO** conserva lo scenario sul dispositivo; **TORNA AL LIVE** ripristina l'osservazione reale.

## METEO LAB — MISSIONI (0.4)

METEO LAB ha due modalità, scelte in alto: **ESPLORA** (il laboratorio: dati reali, TEMPESTA, GRANDINE e
DOWNBURST LAB) e **MISSIONI**, un gioco didattico che insegna attraverso esperimenti **deterministici** basati
sugli **stessi motori meteorologici** del laboratorio. Nessun login, nessun account, nessuna classifica, nessun
numero casuale: stesso scenario + stesse modifiche = stesso risultato.

```
OSSERVA → RICEVI UNA MISSIONE → FORMULA UN'IPOTESI → MODIFICA L'ATMOSFERA → AVVIA L'ESPERIMENTO
→ OSSERVA COSA SUCCEDE → CAPISCI PERCHÉ → MISSIONE COMPLETATA / RIPROVA
```

| # | Missione | Successo (deciso dai motori) | Scenario |
|---|---|---|---|
| 01 | ACCENDI L’ATMOSFERA | energia convettiva didattica oltre la soglia di convezione marginale del ConvectiveEngine | Pianura |
| 02 | COSTRUISCI UNA TEMPESTA | il ConvectiveEngine produce una cella | Pianura |
| 03 | CREA GRANDINE | l’HailEngine produce uno stadio ≠ NONE | Pianura |
| 04 | CREA UN DOWNBURST | il DownburstEngine raggiunge IMPACT | Altopiano semi-arido |
| 05 | TEMPORALE, MA NON SEVERO | cella sì, grandine e downburst no | Pianura |
| 06 | FERMA LA GRANDINE | parte con grandine: cella sì, grandine no | Pianura afosa |
| 07 | FERMA IL DOWNBURST | parte con downburst: cella sì, IMPACT no | Pomeriggio caldo sull’altopiano |
| 08 | IL MINIMO CAMBIAMENTO | cella con INTERVENTO MINIMO | Altopiano interno molto secco |

- **SCENARIO DIDATTICO** (missioni principali): profili reali Open-Meteo **congelati e versionati** nel progetto
  (`src/game/scenarioData.ts`, v1), in due scenari con la superficie impostata per partire da un fenomeno. Non sono
  dati attuali e sono sempre etichettati «SCENARIO DIDATTICO». Ogni missione è realizzabile e non risolta in
  partenza (verificato nei test con gli stessi motori).
- **LIVE CHALLENGE** (avanzata): parte dalle condizioni meteorologiche del momento nel punto scelto
  («ESPERIMENTO SIMULATO»). Se con il meteo di oggi la missione non è realizzabile nel modello, il gioco lo dice.
- Il giocatore modifica solo **temperatura, umidità e vento al suolo** (alcune missioni ne bloccano uno). CAPE, CIN,
  DCAPE, zero termico e indici sono **conseguenze**, mai controlli; nessun valore suggerito.
- **Ipotesi** prima di ogni esperimento («COSA PENSI CHE SUCCEDERÀ?»): non influisce sulla simulazione; alla fine
  PENSAVI / È SUCCESSO e IPOTESI CONFERMATA / CONFERMATA IN PARTE / NON CONFERMATA.
- **Tentativi** numerati, senza penalità. Dopo il secondo tentativo non riuscito compare **INDIZIO**, derivato dal
  fattore limitante calcolato dai motori, senza numeri da impostare.
- **Perché**: frasi causali generate dai risultati dei motori (il momento «aha»), confronto **PRIMA → DOPO** delle sole
  grandezze cambiate ed **EFFETTO** (↑/↓ solo dove il calcolo cambia davvero).
- **Indice di intervento**: distanza normalizzata dallo stato iniziale
  `√((ΔT/10 °C)² + (ΔUR/30 %)² + (Δvento/30 km/h)²)` → INTERVENTO MINIMO (< 0,5), MODERATO (< 1), FORTE.
  Non è un punteggio scientifico.
- **Progressione locale** in IndexedDB (missioni completate, tentativi, miglior intervento, ultima missione).
  Sblocco morbido: 01 e 02 subito; 03, 04, 05 e 08 dopo 02; 06 e 07 dopo aver osservato grandine o downburst;
  **MOSTRA TUTTE LE MISSIONI** le rende sempre accessibili.

Codice: `src/game/MissionEngine.ts` (regole, nessuna meteorologia), `src/game/missions.ts` (le otto missioni),
`src/game/scenarios.ts` (scenari), `src/game/progress.ts` (progressione).

## Dati reali, dati modellistici, simulazione (0.3)

| Livello | Che cos'è | Da dove arriva |
|---|---|---|
| **Osservazione al suolo** (`AtmosphericState`) | Stato attuale a 2 m / 10 m | Open-Meteo, blocco `current` |
| **PROFILO ATMOSFERICO** (`AtmosphericProfile`) | Livelli 1000, 925, 850, 700, 500, 300 hPa: quota geopotenziale, temperatura, umidità, punto di rugiada, vento; CAPE, CIN, Lifted Index e zero termico del modello | Open-Meteo, variabili sui livelli di pressione. **Dato modellistico** (modelli numerici combinati automaticamente, «best match»): **non è un radiosondaggio** |
| **Simulazione** (`SimulationState`) | Esperimento didattico: suolo modificato dall'utente + profilo reale | Calcolata nel browser da METEO LAB. **Non è una previsione** |

I livelli che si trovano sotto il terreno del punto (il provider li estrapola) sono marcati e non vengono usati.
Ogni dato mancante resta `null`. Senza profilo TEMPESTA LAB continua a funzionare con il profilo standard
ipotizzato, mentre GRANDINE LAB e DOWNBURST LAB mostrano **DATI VERTICALI INSUFFICIENTI**.

## GRANDINE LAB e DOWNBURST LAB (0.3)

Esiti possibili dell'esperimento: **TEMPORALE SENZA FENOMENI SEVERI**, **GRANDINE**, **DOWNBURST**,
**GRANDINE + DOWNBURST**. I fenomeni nascono solo con una cella matura, non iniziano mai a T+0 e terminano
con la cella. Al termine l'esperimento spiega **PERCHÉ È SUCCESSO** o **PERCHÉ NON È SUCCESSO** a partire dai
valori calcolati. Gli indici (`hailPotential`, `downburstPotential`, `stormProbability`) sono mostrati come
**indice didattico** 0…1, mai come probabilità: non sono calibrati.

### VerticalProfileEngine (`src/engine/VerticalProfileEngine.ts`)

Quote sopra il suolo (altezza geopotenziale − elevazione), interpolazione lineare fra i livelli (vento per
componenti u/v). Calcola: zero termico (dal profilo; zero termico del provider solo come ripiego),
zero del bulbo umido approssimato (temperatura di bulbo umido di Stull 2011), gradiente 0–3 km (con il suolo
SIM), gradiente 700–500 hPa, shear 0–6 km, secchezza a 700–500 hPa e sotto la base delle nubi (scarto T − Td),
base delle nubi (Espy), isoterme −10/−30 °C e vento medio 0–6 km. Il profilo diventa l'ambiente in cui sale la
particella del ConvectiveEngine (sostituisce il profilo ICAO fisso), e fornisce shear e vento di trasporto.

### HailEngine (`src/engine/HailEngine.ts`)

`hailPotential = updraft × zona di crescita × fusione × (0,5 + 0,5·gradiente 700–500) × (0,6 + 0,4·shear)`

- updraft capace di sostenere i chicchi (v ≈ 12·√D m/s, ordini di grandezza NOAA/NSSL);
- quota della nube nella zona di crescita −10…−30 °C;
- fusione: zero del bulbo umido oltre ~3,4 km sfavorevole;
- aria fredda in quota (gradiente 700–500 hPa) e shear 0–6 km (organizzazione della cella).

Ciclo: `EMBRYO → GROWING → MATURE → FALLING → ENDED`. Classi didattiche `SMALL / MEDIUM / LARGE` (soglie
2,5 e 5 cm del diametro sostenibile, mai mostrato come misura). Sulla mappa: nucleo **GRANDINE SIMULATA**
(contorno tratteggiato chiaro e chicchi, sopra il radar senza coprirlo); nella **sezione verticale**: embrioni sopra
lo zero termico, crescita nella zona −10…−30 °C, caduta al suolo.

### DownburstEngine (`src/engine/DownburstEngine.ts`)

`downburstPotential = loading × DCAPE × (0,5 + 0,5·evaporazione) × (0,6 + 0,4·gradiente 0–3 km)`

- **DCAPE didattica**: aria del livello a θe minima portata alla temperatura di bulbo umido e fatta scendere
  satura fino al suolo sul profilo;
- **precipitation loading**: riflettività di picco della cella;
- **evaporazione**: aria secca sotto la base delle nubi (downburst «secchi», base alta) o a 700–500 hPa
  (downburst «umidi»), Wakimoto 1985;
- **gradiente 0–3 km** vicino all'adiabatica secca; serve una cella matura.

Ciclo: `DEVELOPING → DESCENDING → IMPACT → OUTFLOW → DISSIPATING`, impatto al collasso del nucleo nella
fase matura. Classi `WEAK / MODERATE / STRONG` (17 e 25,7 m/s), mai come velocità previste. Sulla mappa:
**DOWNBURST SIMULATO**, fronte di raffica blu che si espande dal punto d'impatto (più esteso nel verso del moto)
e poi si attenua; nella sezione verticale: discesa, impatto e espansione al suolo.

### Limiti scientifici (0.3)

- Il profilo è modellistico, all'istante corrente e su 6 livelli: strati sottili (inversioni, EML sottili) sfuggono.
- La particella è sollevata dal suolo senza trascinamento né temperatura virtuale: la CAPE didattica resta
  più alta della CAPE del modello (mostrata nel PROFILO per confronto).
- Nessuna microfisica: grandine e downburst sono indici fisicamente motivati, non simulazioni della nube.
- Stull 2011 è valida al livello del mare: in quota lo zero del bulbo umido è approssimato.
- Nessun effetto di orografia, fronti, interazione fra celle o modifica dell'ambiente da parte della cella.

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
  models/       AtmosphericState (osservazione), AtmosphericProfile (profilo modellistico), SimulationState
  providers/    WeatherProvider astratto + OpenMeteoProvider
  engine/       AtmosphereEngine, VerticalProfileEngine, ConvectiveEngine, HailEngine, DownburstEngine,
                SevereWeather (catena completa), SimulatedRadar e SevereGeometry (mappa), fisica elementare
  simulation/   timeline T+0 … T+90 (passo 15 minuti) e testi di TEMPESTA / GRANDINE / DOWNBURST LAB
  game/         MISSIONI: MissionEngine, otto missioni, scenari didattici congelati, progressione
  storage/      IndexedDB: ultima osservazione, ultimo profilo, scenari salvati, progressione missioni
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
- Offline restano disponibili interfaccia, simulazioni e scenari salvati; l'ultima osservazione (con il suo
  profilo) è mostrata come «ULTIMA OSSERVAZIONE» con il suo timestamp. La mappa richiede la connessione.
- Aggiornamenti: il service worker è registrato con un URL diverso a ogni build (`sw.js?v=<bundle>`,
  `updateViaCache: 'none'`), la pagina viene sempre rivalidata e la shell è precaricata ignorando la cache
  HTTP: una nuova versione pubblicata sostituisce subito la precedente, anche con copie vecchie in una CDN.

## Privacy

- Nessuna registrazione, autenticazione, analytics, pubblicità, fingerprinting o cookie.
- L'unico dato che lascia il dispositivo sono le coordinate del punto selezionato, inviate al
  provider meteorologico in due richieste (suolo e profilo), senza credenziali e senza referrer.
- Osservazioni, scenari e progressione delle missioni restano nell'IndexedDB del browser.
- Le tile della mappa sono scaricate da OpenFreeMap, come per qualunque mappa web.

## Fonti dati

- **Open-Meteo** — Forecast API, blocco `current` (`https://api.open-meteo.com/v1/forecast`),
  documentazione: <https://open-meteo.com/en/docs>. Variabili al suolo e variabili sui livelli di pressione
  (`temperature_850hPa`, `geopotential_height_500hPa`, …), `cape`, `convective_inhibition`, `lifted_index`,
  `freezing_level_height`. Gratuita per uso non commerciale, senza chiave. Dati con licenza **CC BY 4.0**.
  Citazione: Zippenfenig, P. (2023). *Open-Meteo.com Weather API* [Computer software]. Zenodo.
  <https://doi.org/10.5281/zenodo.7970649>. I dati derivano dai modelli dei servizi meteorologici nazionali
  combinati da Open-Meteo.
- **Mappa** — OpenFreeMap, © OpenMapTiles, dati © OpenStreetMap contributors.

## Avvertenza

METEO LAB è un progetto educativo e sperimentale. Le simulazioni non costituiscono previsioni
meteorologiche, allerte o indicazioni di sicurezza. Per allerte e informazioni ufficiali fare
sempre riferimento alle autorità competenti.

## Roadmap essenziale

- 0.1 — Osservazione reale puntuale, simulazione didattica di temperatura, umidità e vento. ✔
- 0.2 — TEMPESTA LAB: ConvectiveEngine didattico e radar simulato animato sulla mappa. ✔
- 0.3 — PROFILO ATMOSFERICO (Open-Meteo), VerticalProfileEngine, GRANDINE LAB e DOWNBURST LAB. ✔
- 0.4 — METEO LAB MISSIONI: otto missioni deterministiche, scenari didattici, LIVE CHALLENGE, ipotesi e indizi. ✔
- Prossimi passi — nuovi provider (radar, satellite, fulminazioni) sulla stessa architettura;
  nuove missioni; confronto fra simulazione e osservazioni successive.

## Licenza

MIT © 2026 Alessandro Pezzali — vedi [LICENSE](LICENSE).
