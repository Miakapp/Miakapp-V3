import type { DeviceGuide } from '../device-guide';

export const VELUX_GUIDE: DeviceGuide = {
  id: 'guide-velux',
  checked: '2026-11',
  sources: [
    { label: 'Home Assistant — Velux integration', url: 'https://www.home-assistant.io/integrations/velux' },
    { label: 'VELUX — KLI 310/311/312 wall switches (io-homecontrol, 868 MHz)', url: 'https://www.velux.co.uk/professionals/technical-library/smart-home-systems/operation-and-remote-controls/kli-310' },
    { label: 'iown-homecontrol — open documentation of the io-homecontrol protocol', url: 'https://github.com/Velocet/iown-homecontrol' },
    { label: 'openHAB — Velux binding (KLF 200 limits)', url: 'https://www.openhab.org/addons/bindings/velux/' },
    { label: 'pyvlx — Python library for the KLF 200 (“discontinued by Velux”)', url: 'https://github.com/Julius2342/pyvlx' },
    { label: 'VELUX — KLF 150 interface', url: 'https://www.velux.co.uk/professionals/technical-library/smart-home-systems/accessories/klf-150' },
    { label: 'klf-200-api — Node.js library for the KLF 200', url: 'https://unpkg.com/klf-200-api@4.1.3/README.md' },
    { label: 'Somfy — TaHoma Developer Mode (local API)', url: 'https://github.com/Somfy-Developer/Somfy-TaHoma-Developer-Mode' },
    { label: 'Home Assistant — Overkiz integration (TaHoma local API)', url: 'https://www.home-assistant.io/integrations/overkiz' },
    { label: 'Home Assistant community — Overkiz local API testers (Velux windows, rain sensor)', url: 'https://community.home-assistant.io/t/overkiz-integration-local-api-development-testers-topic/485264' },
    { label: 'velux_applehome_esp32 — ESP32 relays on KLI 311/312 switches', url: 'https://github.com/SI-LC/velux_applehome_esp32' },
    { label: 'Home Assistant community — Velux remote driven by an ESP and ESPHome', url: 'https://community.home-assistant.io/t/controlling-velux-remote-with-esp8266-and-esphome/591751' },
    { label: 'Velux on HomeKit through a Zigbee relay soldered to a KLI switch', url: 'https://fearthecow.pages.dev/projects/velux-homekit-siri-via-zigbee-no-gateway' },
    { label: 'Hornbach — VELUX App Control KIG 300 (price)', url: 'https://www.hornbach.de/p/velux-app-control-kig-300/10452057/' },
    { label: 'Servistores — VELUX KLI 311 switch (price)', url: 'https://www.servistores.com/html/produits/bouton-volet-roulant-Velux-KLI311-VELKLI311.html' },
    { label: 'TinyTronics — LilyGO T-Relay ESP32 board (price)', url: 'https://www.tinytronics.nl/en/switches/relays/relay-modules/lilygo-ttgo-t-relay-esp32-development-board' },
    { label: 'Servistores — Somfy TaHoma Switch (price)', url: 'https://www.servistores.com/html/produits/domotique-pack-Somfy-SO1870595.html' },
    { label: 'baubay — VELUX KLF 200 (price)', url: 'https://baubay.de/home-interface-velux-klf-200.html' },
    { label: 'Home Assistant community — KIG 300 over HomeKit, no stop command', url: 'https://community.home-assistant.io/t/velux-integration-klf200-or-kix300/443600/2' },
  ],
  copy: {
    fr: {
      kicker: 'Guide · Velux',
      title: 'Piloter ses Velux sans le boîtier officiel.',
      titleAccent: 'sans le boîtier officiel',
      lede: 'Fenêtres de toit, volets et stores Velux motorisés depuis votre téléphone et dans vos automatisations, sans dépendre du cloud de Velux. Ce qui marche vraiment, ce qui ne marche pas, et ce que ça coûte.',
      problemTitle: 'Le problème',
      problem: [
        'Les Velux motorisés (gamme INTEGRA, volets et stores électriques ou solaires) se commandent à la télécommande. Pour les piloter depuis un téléphone, Velux vend une box : aujourd’hui la VELUX App Control KIG 300, autour de 100 à 120 € [14], seule ou dans le kit VELUX ACTIVE. Elle passe par le cloud de Velux et Netatmo ; seule exception, elle se pilote localement par Apple HomeKit [1], où des utilisateurs signalent qu’elle n’accepte pas l’ordre « stop » [19].',
        'L’ancienne passerelle KLF 200, la seule avec une vraie API locale, n’est plus fabriquée [5]. Sa remplaçante, la KLF 150, n’a que des contacts secs pour cinq produits ou groupes, et pas d’API [6].',
      ],
      howTitle: 'Pourquoi on ne peut pas simplement copier la télécommande',
      how: [
        'Les Velux récents parlent io-homecontrol : une radio 868 MHz, bidirectionnelle, chiffrée avec une clé propre à chaque installation [2][3]. Le moteur lance un défi que seuls les appareils qui ont la clé savent relever. Enregistrer le signal et le rejouer, comme on le fait pour un portail en 433 MHz, ne marche donc pas [3].',
        'Un projet libre documente le protocole, mais ses bibliothèques sont encore en chantier : ce n’est pas une solution aujourd’hui [3]. Il reste deux façons honnêtes de faire : se servir d’une télécommande officielle comme d’une boîte noire, ou passer par une passerelle qui détient la clé et ouvre une API locale.',
      ],
      routesTitle: 'Trois façons de faire',
      routes: [
        {
          name: 'Un ESP32 sur un interrupteur mural Velux',
          verdict: 'La moins chère et 100 % locale, mais sans retour d’état.',
          recommended: true,
          body: [
            'Vous achetez un interrupteur mural Velux de plus (KLI 311 ou 312), associé à vos fenêtres comme n’importe quelle télécommande. Une carte ESP32 à relais « appuie » sur ses boutons par de brèves impulsions : c’est l’interrupteur qui chiffre, l’ESP32 ne fait que presser [11][12][13].',
            'La limite : un bouton ne renvoie rien. La position est estimée d’après le temps de course, et un bricoleur qui pilote cinq stores ainsi envoie chaque ordre deux fois, parce qu’un store le rate parfois [13]. Il faut souder sur de petites pastilles.',
          ],
          hardware: [
            { item: 'Interrupteur mural VELUX KLI 311 [15]', price: '≈ 38 €' },
            { item: 'Carte LilyGO T-Relay (ESP32, 4 relais) [16]', price: '≈ 15 €' },
            { item: 'Alimentation, fils', price: '≈ 10 €' },
          ],
          total: '≈ 50 à 70 €',
        },
        {
          name: 'Une box tierce avec API locale',
          verdict: 'La position remonte, sans box Velux. Mais c’est une autre box.',
          body: [
            'La Somfy TaHoma Switch parle io-homecontrol. En mode développeur, elle ouvre une API locale en HTTPS avec un jeton, que l’agent interroge depuis le coordinateur [8][9]. Des utilisateurs y pilotent leurs fenêtres de toit Velux [10].',
            'Limites : il faut encore l’application et le cloud de Somfy pour ajouter des appareils et pour les mises à jour, et le capteur de pluie des Velux n’y remonterait pas d’après ces utilisateurs [10].',
          ],
          hardware: [
            { item: 'Somfy TaHoma Switch [17]', price: '≈ 115 à 180 €' },
          ],
          total: '≈ 115 à 180 €',
        },
        {
          name: 'Si vous avez déjà une KLF 200',
          verdict: 'La plus complète : position, capteur de pluie, fins de course. Mais elle n’est plus fabriquée.',
          body: [
            'Depuis le firmware 2.0.0.71, la KLF 200 a une API locale sur le réseau. L’agent la pilote avec une bibliothèque existante, klf-200-api en Node.js ou pyvlx en Python [5][7].',
            'Limites connues : deux connexions simultanées au plus, firmware impossible à rétrograder, et un état de pluie seulement relu toutes les cinq minutes [1][4].',
          ],
          hardware: [
            { item: 'VELUX KLF 200, fin de stock ou occasion [18]', price: '≈ 200 à 260 €' },
          ],
          total: '≈ 200 à 260 €',
        },
      ],
      askTitle: 'Ce que vous pouvez demander ensuite',
      asks: [
        'Ferme toutes les fenêtres de toit si de la pluie est annoncée dans l’heure ou si le vent dépasse 40 km/h, et dis-moi lesquelles étaient ouvertes.',
        'Aère la chambre dix minutes à 7 h si le CO₂ a dépassé 1 200 ppm pendant la nuit, sauf s’il fait moins de 5 °C dehors.',
        'Descends les stores de toit côté sud quand le soleil tape et qu’il fait plus de 25 °C dans les combles.',
      ],
      agentTitle: 'Ce que fait l’agent',
      agent: [
        'Il choisit la voie avec vous d’après ce que vous avez déjà : une KLF 200 qui traîne change tout.',
        'Voie ESP32 : il écrit le firmware (ESPHome ou le sien), vous guide pour associer le nouvel interrupteur, chronomètre la course de chaque fenêtre pour estimer sa position, et répète les ordres qui risquent d’être perdus.',
        'Voie passerelle : il active l’API locale, garde le jeton dans la configuration du coordinateur et jamais dans le code, puis découvre vos produits.',
        'Il ajoute une commande par fenêtre et un « tout fermer » dans l’app, et branche les automatisations sur la météo et vos capteurs.',
      ],
      caveatsTitle: 'À savoir avant de commencer',
      caveats: [
        'Aucun émetteur radio bon marché ne remplace une télécommande io-homecontrol : le chiffrement est là pour ça [3].',
        'Souder dans un interrupteur Velux annule très probablement sa garantie.',
        'Ne comptez pas sur la box pour savoir s’il pleut : relu toutes les cinq minutes par la KLF 200, absent via la TaHoma selon des utilisateurs, inexistant avec un bouton [1][10]. Pour fermer à la pluie, l’agent croise un capteur ou une prévision.',
        'Une mise à jour de firmware peut changer une API locale : celle de la KLF 200 a changé avec la version 2 [4].',
      ],
      pricesNote: 'Prix relevés en novembre 2026 chez des revendeurs européens ; ils varient selon le pays et le moment.',
    },
    en: {
      kicker: 'Guide · Velux',
      title: 'Control your Velux without the official hub.',
      titleAccent: 'without the official hub',
      lede: 'Velux roof windows, shutters and blinds from your phone and in your automations, without depending on Velux’s cloud. What actually works, what does not, and what it costs.',
      problemTitle: 'The problem',
      problem: [
        'Motorised Velux products (the INTEGRA range, electric or solar shutters and blinds) come with a remote. To control them from a phone, Velux sells a box: today the VELUX App Control KIG 300, around €100 to €120 [14], alone or in the VELUX ACTIVE kit. It goes through Velux and Netatmo’s cloud; the one exception is local control through Apple HomeKit [1], where users report it does not accept a “stop” command [19].',
        'The older KLF 200 gateway, the only one with a real local API, is no longer made [5]. Its replacement, the KLF 150, only has dry contacts for five products or groups, and no API [6].',
      ],
      howTitle: 'Why you cannot just copy the remote',
      how: [
        'Recent Velux products speak io-homecontrol: an 868 MHz, two-way radio, encrypted with a key unique to each installation [2][3]. The motor sends a challenge only devices holding the key can answer. Recording the signal and replaying it, as people do with a 433 MHz gate remote, does not work [3].',
        'An open project documents the protocol, but its libraries are still a work in progress: it is not a solution today [3]. That leaves two honest options: use an official remote as a black box, or go through a gateway that holds the key and opens a local API.',
      ],
      routesTitle: 'Three ways to do it',
      routes: [
        {
          name: 'An ESP32 on a Velux wall switch',
          verdict: 'The cheapest and fully local, but with no state feedback.',
          recommended: true,
          body: [
            'You buy one more Velux wall switch (KLI 311 or 312), paired with your windows like any remote. An ESP32 relay board “presses” its buttons with short pulses: the switch does the encryption, the ESP32 only presses [11][12][13].',
            'The catch: a button reports nothing. Position is estimated from travel time, and one tinkerer driving five blinds this way sends every command twice because a blind sometimes misses it [13]. You need to solder onto small pads.',
          ],
          hardware: [
            { item: 'VELUX KLI 311 wall switch [15]', price: '≈ €38' },
            { item: 'LilyGO T-Relay board (ESP32, 4 relays) [16]', price: '≈ €15' },
            { item: 'Power supply, wires', price: '≈ €10' },
          ],
          total: '≈ €50 to €70',
        },
        {
          name: 'A third-party hub with a local API',
          verdict: 'Position comes back, with no Velux box. But it is another box.',
          body: [
            'The Somfy TaHoma Switch speaks io-homecontrol. In developer mode it opens a local HTTPS API with a token, which the agent queries from the coordinator [8][9]. Users drive their Velux roof windows with it [10].',
            'Limits: Somfy’s app and cloud are still needed to add devices and for updates, and according to those users the Velux rain sensor does not show up [10].',
          ],
          hardware: [
            { item: 'Somfy TaHoma Switch [17]', price: '≈ €115 to €180' },
          ],
          total: '≈ €115 to €180',
        },
        {
          name: 'If you already own a KLF 200',
          verdict: 'The most complete: position, rain sensor, limits. But it is no longer made.',
          body: [
            'Since firmware 2.0.0.71 the KLF 200 has a local network API. The agent drives it with an existing library, klf-200-api for Node.js or pyvlx for Python [5][7].',
            'Known limits: two simultaneous connections at most, firmware that cannot be downgraded, and a rain state only read every five minutes [1][4].',
          ],
          hardware: [
            { item: 'VELUX KLF 200, old stock or second-hand [18]', price: '≈ €200 to €260' },
          ],
          total: '≈ €200 to €260',
        },
      ],
      askTitle: 'What you can ask next',
      asks: [
        'Close every roof window if rain is forecast within the hour or the wind goes over 40 km/h, and tell me which ones were open.',
        'Air the bedroom for ten minutes at 7 am if CO₂ went over 1,200 ppm during the night, unless it is below 5 °C outside.',
        'Lower the south-facing roof blinds when the sun hits and the loft is over 25 °C.',
      ],
      agentTitle: 'What the agent does',
      agent: [
        'It picks the route with you based on what you already have: a KLF 200 in a drawer changes everything.',
        'ESP32 route: it writes the firmware (ESPHome or its own), walks you through pairing the new switch, times each window’s travel to estimate its position, and repeats commands that might be lost.',
        'Gateway route: it enables the local API, keeps the token in the coordinator’s configuration and never in the code, then discovers your products.',
        'It adds a control per window and an “everything closed” button to the app, and wires the automations to the weather and your sensors.',
      ],
      caveatsTitle: 'Before you start',
      caveats: [
        'No cheap radio transmitter replaces an io-homecontrol remote: that is what the encryption is for [3].',
        'Soldering inside a Velux switch most likely voids its warranty.',
        'Do not rely on the hub to know whether it is raining: read every five minutes by the KLF 200, missing through the TaHoma according to users, absent with a button [1][10]. To close on rain, the agent uses a sensor or a forecast.',
        'A firmware update can change a local API: the KLF 200’s changed with version 2 [4].',
      ],
      pricesNote: 'Prices checked in November 2026 at European retailers; they vary by country and over time.',
    },
  },
};
