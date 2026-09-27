# METEO LAB

**Osserva. Interpreta. Simula.**

METEO LAB è una Progressive Web App educativa e sperimentale dedicata alla meteorologia.
Non è un'app meteo tradizionale e non fornisce previsioni: usa dati meteorologici reali come
punto di partenza per osservare, interpretare e sperimentare con un simulatore didattico.

Versione: **0.1.0** · Autore: **Alessandro Pezzali** · Licenza: **MIT**

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

1. Seleziona un punto sulla mappa (clic, oppure frecce/zoom da tastiera e «Seleziona centro mappa").
2. METEO LAB richiede lo stato atmosferico reale e lo mostra nella console dati.
3. Premi **CREA SIMULAZIONE**: l'osservazione viene copiata in un `SimulationState` separato.
4. Modifica temperatura, umidità relativa e vento iniziali; usa **AVVIA**, **PAUSA**, **RESET**
   e la timeline T+0 … T+90 minuti.
5. **SALVA SCENARIO** conserva lo scenario sul dispositivo; **TORNA AL LIVE** ripristina l'osservazione reale.

La posizione dell'utente non viene mai richiesta.

## Architettura

```
src/
  models/       AtmosphericState (osservazione reale, immutabile) e SimulationState
  providers/    WeatherProvider astratto + OpenMeteoProvider
  engine/       AtmosphereEngine (modello didattico) e relazioni fisiche elementari
  simulation/   timeline T+0 … T+90 (passo 15 minuti)
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
6. pressione e direzione del vento invariate nella versione 0.1.

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

La build usa percorsi relativi (`base: './'`): `dist/` può essere pubblicata in una sottocartella
di qualsiasi hosting statico.

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
- Prossimi passi — nuovi provider (radar, satellite, fulminazioni) sulla stessa architettura;
  estensione del motore didattico a fenomeni convettivi; confronto fra simulazione e osservazioni
  successive.

## Licenza

MIT © 2026 Alessandro Pezzali — vedi [LICENSE](LICENSE).
