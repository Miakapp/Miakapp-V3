import type { DeviceGuide } from '../device-guide';

export const TOSHIBA_AC_GUIDE: DeviceGuide = {
  id: 'guide-toshiba-ac',
  checked: '2026-11',
  sources: [
    { label: 'Toshiba UK — RB-N105S-G Wi-Fi adapter (compatible ranges)', url: 'https://www.toshiba-aircon.co.uk/en/products/controls/wifi-control/rb-n105s-g-wifi-adaper.html' },
    { label: 'Climamarket — RB-N106S-G Wi-Fi module (compatible models)', url: 'https://climamarket.com/products/toshiba-rb-n106s-g-wi-fi-module-for-residential-range-air-conditioners' },
    { label: 'Climaffaires — RB-N106S-G (price)', url: 'https://www.climaffaires.com/toshiba/2762-toshiba-accessoire-module-wifi-rbn106s.html' },
    { label: 'Planète Air — RB-N106S-G (price)', url: 'https://www.planete-air.eu/interface-wi-fi-toshiba/1140--toshiba-wifi-rb-n106s-g-8855169087322.html' },
    { label: 'Amifrigo — RB-N106S-G (price)', url: 'https://www.amifrigo.com/interface-wifi-rb-n106s-g-de-toshiba.html' },
    { label: 'home-assistant-toshiba_ac — community integration through Toshiba’s cloud', url: 'https://github.com/h4de5/home-assistant-toshiba_ac' },
    { label: 'ESPHome — IR remote climate, Toshiba platform', url: 'https://esphome.io/components/climate/climate_ir/' },
    { label: 'Home Assistant — Broadlink integration', url: 'https://www.home-assistant.io/integrations/broadlink/' },
    { label: 'SmartIR — climate code sets (Toshiba)', url: 'https://github.com/smartHomeHub/SmartIR/blob/master/docs/CLIMATE.md' },
    { label: 'Great Technology — Broadlink RM4 mini (price)', url: 'https://great-technology.be/products/universal-remote-control-broadlink-rm4-mini' },
    { label: 'esphome_toshiba_suzumi — ESPHome component on the CN22 connector', url: 'https://github.com/pedobry/esphome_toshiba_suzumi' },
    { label: 'esphome-toshiba-hvac-controller — ESP32 board for the same connector', url: 'https://github.com/florianbrede-ayet/esphome-toshiba-hvac-controller' },
    { label: 'shorai-esp32 — ESP32 board for Shorai and Seiya (MQTT)', url: 'https://github.com/toremick/shorai-esp32' },
    { label: 'Elecena — ESP32-DevKitC (price)', url: 'https://elecena.pl/product/17815383/esp-32-dev-kit-c-v4' },
    { label: 'Soldered — logic level converter (price)', url: 'https://soldered.com/product/logic-level-converter-generic-txb0104-breakout/' },
    { label: 'Heatable — Toshiba Haori review (built-in Wi-Fi)', url: 'https://heatable.co.uk/air-conditioning/advice/toshiba-haori-air-conditioner-review' },
  ],
  copy: {
    fr: {
      kicker: 'Guide · Climatisation Toshiba',
      title: 'Piloter sa clim Toshiba sans le module Wi-Fi.',
      titleAccent: 'sans le module Wi-Fi',
      lede: 'Votre climatisation Toshiba depuis votre téléphone et dans vos automatisations, sans l’adaptateur Wi-Fi vendu à part ni le cloud de Toshiba. Deux façons de faire, et laquelle choisir.',
      problemTitle: 'Le problème',
      problem: [
        'Sur la plupart des splits Toshiba résidentiels (Seiya, Shorai, Daiseikai…), le Wi-Fi est une option : un module RB-N106S-G (ou RB-N105S-G selon les modèles) compte entre 110 et 175 € avant la pose, pour une seule unité intérieure [1][2][3][4][5]. Certains modèles, comme la Haori, l’ont d’origine [16].',
        'Le module passe par l’application Toshiba Home AC Control et le cloud de Toshiba ; nous n’avons trouvé aucune API locale documentée. L’intégration Home Assistant de la communauté passe par ce même cloud, et son auteur attribue la plupart des pannes aux indisponibilités du cloud de Toshiba [6].',
      ],
      howTitle: 'Deux portes d’entrée',
      how: [
        'Une clim se commande de deux façons : par la télécommande infrarouge, que tout le monde a, ou par le connecteur sur lequel se branche le module Wi-Fi officiel, à l’intérieur de l’unité. Le premier chemin est simple mais aveugle ; le second voit tout, mais demande d’ouvrir le capot.',
      ],
      routesTitle: 'Deux façons de faire',
      routes: [
        {
          name: 'Un ESP32 à la place du module Wi-Fi',
          verdict: 'Locale et bidirectionnelle, pour environ un cinquième du prix du module.',
          recommended: true,
          body: [
            'Le module officiel se branche sur un connecteur de l’unité intérieure, le CN22. Des projets libres y mettent un ESP32 qui parle le même protocole série : consigne, mode, ventilation, oscillation, et les températures intérieure et extérieure quand l’unité les donne [11][12][13].',
            'Il marche sur les modèles compatibles avec les modules RB-N105S-G et RB-N106S-G : Seiya, Shorai, Shorai Edge, Daiseikai 9, Suzumi Plus, entre autres [11]. Côté technique : prise JST PA 5 broches, unité en 5 V contre 3,3 V pour l’ESP32 donc un adaptateur de niveau, et la broche 5 ne doit pas être branchée [11].',
            'On ne branche et ne débranche qu’avec la clim coupée au disjoncteur [11]. Si vous n’êtes pas à l’aise, faites poser le boîtier par un installateur : l’agent prépare tout le reste.',
          ],
          hardware: [
            { item: 'Carte ESP32-DevKitC [14]', price: '≈ 14 €' },
            { item: 'Adaptateur de niveau 5 V ↔ 3,3 V [15]', price: '≈ 3 à 6 €' },
            { item: 'Câble avec prise JST PA 5 broches, boîtier', price: '≈ 5 €' },
          ],
          total: '≈ 20 à 30 €',
        },
        {
          name: 'Un émetteur infrarouge',
          verdict: 'Sans outil ni ouverture, mais à l’aveugle.',
          body: [
            'ESPHome a une plateforme de climatisation infrarouge pour Toshiba, avec un récepteur facultatif pour entendre la vraie télécommande [7]. Autre option, un Broadlink RM4 mini, piloté en local, avec les jeux de codes Toshiba que recense le projet SmartIR [8][9].',
            'Limites : l’infrarouge ne renvoie rien, donc personne ne sait si l’ordre a été reçu ; il faut une ligne de vue avec l’unité ; et la température de la pièce vient d’un capteur séparé.',
          ],
          hardware: [
            { item: 'Broadlink RM4 mini [10]', price: '≈ 17 à 35 €' },
            { item: 'ou ESP32 + LED infrarouge + récepteur', price: '≈ 15 à 25 €' },
          ],
          total: '≈ 15 à 35 €',
        },
      ],
      askTitle: 'Ce que vous pouvez demander ensuite',
      asks: [
        'Rafraîchis le bureau à 24 °C quand les panneaux produisent plus que la maison ne consomme, et coupe la clim dès qu’une fenêtre de la pièce est ouverte.',
        'Pendant une canicule, rafraîchis chaque chambre une heure avant que son occupant se couche d’habitude.',
        'Si la clim tourne alors que plus personne n’est là depuis trente minutes, éteins-la et dis-le-moi.',
      ],
      agentTitle: 'Ce que fait l’agent',
      agent: [
        'Il identifie votre modèle exact et vous dit quelle voie il permet, avec la liste de courses.',
        'Voie filaire : il configure le composant ESPHome, flashe et teste l’ESP32 sur table avant toute pose, puis vous donne, ou donne à l’installateur, le schéma de branchement. Il ne vous demande jamais d’ouvrir une unité sous tension.',
        'Voie infrarouge : il choisit le jeu de codes qui correspond à votre télécommande, le vérifie commande par commande, et tient lui-même l’état affiché.',
        'Il ajoute la clim à l’app de chaque habitant concerné, avec les droits que vous voulez, et écrit les automatisations.',
      ],
      caveatsTitle: 'À savoir avant de commencer',
      caveats: [
        'Les fonctions disponibles varient d’un modèle à l’autre, même en filaire [11].',
        'Ce sont des projets communautaires, qui suivent les versions d’ESPHome : l’agent les met à jour quand il le faut [11].',
        'Nous n’avons trouvé aucune position de Toshiba sur la garantie dans ce cas : renseignez-vous auprès de votre installateur avant d’ouvrir l’unité.',
        'Coupez toujours le disjoncteur de la clim avant de toucher au connecteur [11].',
      ],
      pricesNote: 'Prix relevés en novembre 2026 chez des revendeurs européens ; ils varient selon le pays et le moment.',
    },
    en: {
      kicker: 'Guide · Toshiba air conditioning',
      title: 'Control a Toshiba air conditioner without the Wi-Fi module.',
      titleAccent: 'without the Wi-Fi module',
      lede: 'Your Toshiba air conditioner from your phone and in your automations, without the Wi-Fi adapter sold separately or Toshiba’s cloud. Two ways to do it, and which one to pick.',
      problemTitle: 'The problem',
      problem: [
        'On most residential Toshiba split units (Seiya, Shorai, Daiseikai…), Wi-Fi is an option: an RB-N106S-G module (or RB-N105S-G depending on the model) costs between €110 and €175 before installation, for a single indoor unit [1][2][3][4][5]. Some models, such as the Haori, have it built in [16].',
        'The module goes through the Toshiba Home AC Control app and Toshiba’s cloud; we found no documented local API. The community Home Assistant integration goes through the same cloud, and its author attributes most failures to Toshiba’s cloud being down [6].',
      ],
      howTitle: 'Two ways in',
      how: [
        'An air conditioner can be controlled in two ways: through the infrared remote everyone has, or through the connector the official Wi-Fi module plugs into, inside the unit. The first path is simple but blind; the second sees everything, but means opening the cover.',
      ],
      routesTitle: 'Two ways to do it',
      routes: [
        {
          name: 'An ESP32 instead of the Wi-Fi module',
          verdict: 'Local and two-way, for about a fifth of the module’s price.',
          recommended: true,
          body: [
            'The official module plugs into a connector on the indoor unit, CN22. Open projects put an ESP32 there that speaks the same serial protocol: set point, mode, fan, swing, and indoor and outdoor temperatures when the unit reports them [11][12][13].',
            'It works on models compatible with the RB-N105S-G and RB-N106S-G modules: Seiya, Shorai, Shorai Edge, Daiseikai 9, Suzumi Plus, among others [11]. Technically: a 5-pin JST PA plug, a 5 V unit against 3.3 V for the ESP32 so a level shifter, and pin 5 must stay unconnected [11].',
            'Only plug or unplug it with the unit switched off at the breaker [11]. If you are not comfortable, have an installer fit the board: the agent prepares everything else.',
          ],
          hardware: [
            { item: 'ESP32-DevKitC board [14]', price: '≈ €14' },
            { item: '5 V ↔ 3.3 V level shifter [15]', price: '≈ €3 to €6' },
            { item: 'Cable with a 5-pin JST PA plug, case', price: '≈ €5' },
          ],
          total: '≈ €20 to €30',
        },
        {
          name: 'An infrared transmitter',
          verdict: 'No tools, no opening, but blind.',
          body: [
            'ESPHome has an infrared climate platform for Toshiba, with an optional receiver to hear the real remote [7]. Another option is a Broadlink RM4 mini, controlled locally, with the Toshiba code sets listed by the SmartIR project [8][9].',
            'Limits: infrared sends nothing back, so nobody knows whether the command was received; it needs line of sight to the unit; and the room temperature comes from a separate sensor.',
          ],
          hardware: [
            { item: 'Broadlink RM4 mini [10]', price: '≈ €17 to €35' },
            { item: 'or ESP32 + infrared LED + receiver', price: '≈ €15 to €25' },
          ],
          total: '≈ €15 to €35',
        },
      ],
      askTitle: 'What you can ask next',
      asks: [
        'Cool the study to 24 °C when the solar panels produce more than the house uses, and switch the unit off as soon as a window in that room opens.',
        'During a heatwave, cool each bedroom an hour before the person who sleeps there usually goes to bed.',
        'If the air conditioning is running and nobody has been home for thirty minutes, switch it off and tell me.',
      ],
      agentTitle: 'What the agent does',
      agent: [
        'It identifies your exact model and tells you which route it allows, with the shopping list.',
        'Wired route: it configures the ESPHome component, flashes and tests the ESP32 on the bench before anything is fitted, then gives you, or your installer, the wiring diagram. It never asks you to open a unit that is powered.',
        'Infrared route: it picks the code set that matches your remote, checks it command by command, and keeps track of the displayed state itself.',
        'It adds the unit to the app of each person concerned, with the rights you want, and writes the automations.',
      ],
      caveatsTitle: 'Before you start',
      caveats: [
        'Available features vary from model to model, even wired [11].',
        'These are community projects that follow ESPHome releases: the agent updates them when needed [11].',
        'We found no statement from Toshiba on the warranty in this case: ask your installer before opening the unit.',
        'Always switch off the unit’s breaker before touching the connector [11].',
      ],
      pricesNote: 'Prices checked in November 2026 at European retailers; they vary by country and over time.',
    },
  },
};
