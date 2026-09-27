export function Footer({ version, build }: { readonly version: string; readonly build: string }) {
  return (
    <footer className="footer">
      <details className="disclaimer">
        <summary>Informazioni</summary>
        <p>
          METEO LAB è un progetto educativo e sperimentale. Le simulazioni non costituiscono previsioni
          meteorologiche, allerte o indicazioni di sicurezza.
        </p>
        <p>Per allerte e informazioni ufficiali fare sempre riferimento alle autorità competenti.</p>
        <p>
          Privacy: nessun account, nessun tracciamento, nessun cookie. L&apos;unico dato inviato all&apos;esterno sono le
          coordinate del punto selezionato, trasmesse al provider meteorologico. Osservazioni e scenari restano
          sul dispositivo.
        </p>
        <p>
          Dati meteo:{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo.com
          </a>{' '}
          · Mappa:{' '}
          <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">
            OpenFreeMap
          </a>
          , ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            OpenStreetMap
          </a>
        </p>
      </details>
      <p className="footer__credits">
        METEO LAB v{version} · build <span className="footer__build">{build}</span> · Alessandro Pezzali · Licenza MIT
      </p>
    </footer>
  );
}
