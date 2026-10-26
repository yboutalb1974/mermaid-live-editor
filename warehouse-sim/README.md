# Pick Path Lab

Simulatore per confrontare layout e slotting di un magazzino sugli stessi ordini, prima di spostare uno scaffale.
Scritto da zero, gira interamente nel browser, nessuna dipendenza e nessun dato inviato a server.

## Uso

Apri `warehouse-sim/index.html` in un browser. All'avvio si carica un progetto di esempio (dati illustrativi) e
la simulazione viene eseguita subito.

1. **Layout**: pianta su griglia da 1 m. Trascina gli scaffali, aggiungine, posa partenza e arrivo, oppure usa il
   generatore di scaffalature (corridoi verticali od orizzontali, corridoio di fondo, corridoio trasversale).
   "Variante slotting ABC" crea una copia con gli SKU più richiesti sulle ubicazioni più vicine.
   Il pulsante **3D** mostra il layout in tre dimensioni (altezza scaffali e livelli impostabili), con percorso
   campione e mappa di calore; si ruota trascinando e si seleziona uno scaffale con un clic. È solo una vista:
   i calcoli restano a terra. Il motore 3D (three.js) si scarica da cdnjs alla prima apertura, quindi serve
   internet; il resto funziona offline.
   "Colora per" mostra visite, classe ABC o ubicazioni cambiate rispetto alla baseline (in 2D e in 3D);
   "Trova SKU" evidenzia dove si trova un articolo.
2. **Domanda e ordini**: catalogo SKU con pesi di frequenza (classi ABC calcolate) e import CSV; import di
   ordini storici (`OrderID;SKU;Qty`) per simulare con le combinazioni reali di SKU.
3. **Parametri**: numero ordini, righe per ordine, velocità, tempi per riga e per pezzo, batch (più ordini per
   giro), sequenza di visita (alfabetica, vicino più prossimo, ottimizzata 2-opt) ed economia (costo orario,
   turni, giorni, utilizzo).
4. **Risultati**: distanza e tempo per ordine, P95, ordini/ora, FTE, costo per ordine e annuo, risparmio rispetto
   alla baseline, intervallo di robustezza su altri seed, ubicazioni più visitate, percorsi campione animati sulla
   pianta e mappa di calore, quota di visite nella "zona calda" (20 % di ubicazioni più vicine).
   **Piano di spostamenti**: per una variante con le stesse ubicazioni della baseline (per esempio lo slotting
   ABC) elenca gli scambi in ordine di priorità e mostra, simulando, quante mosse servono per l'80 % del
   guadagno. "Crea layout con queste mosse" genera il layout parziale e lo simula sugli stessi ordini.

Il progetto si salva automaticamente nel browser; "Esporta progetto" produce un JSON da conservare o condividere.

## Sviluppo

```
warehouse-sim/
  src/engine.js        motore di simulazione (funzioni pure, nessun DOM)
  src/app.js           interfaccia
  src/view3d.js        vista 3D (three.js caricato su richiesta)
  src/styles.css       stile
  src/page.html        struttura della pagina
  build.mjs            unisce tutto in un unico file HTML
  test/engine.check.mjs
```

```bash
node warehouse-sim/build.mjs                         # rigenera warehouse-sim/index.html
node --test warehouse-sim/test/engine.check.mjs      # test del motore
```

`index.html` e `dist/` sono generati: modifica i file in `src/` e ricostruisci.

## Modello e limiti

- Cammini minimi ortogonali su griglia da 1 m (ricerca in ampiezza); celle occupate da scaffali bloccate.
- Ogni riga viene presa da un'ubicazione già nel giro, altrimenti dalla più vicina alla partenza con stock
  sufficiente; lo stock si ripristina a ogni giro.
- Non modellati: più operatori e congestione, sensi unici, prelievo in quota, rifornimenti, vincoli di sicurezza.
  Valida con tempi misurati sul campo prima di decidere un investimento.
