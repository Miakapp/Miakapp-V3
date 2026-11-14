import type { DeviceGuide } from '../device-guide';

export const SOMFY_RTS_GUIDE: DeviceGuide = {
  id: 'guide-somfy-rts',
  checked: '2026-11',
  sources: [
    { label: 'Somfy — LT RTS receiver manual (433.42 MHz)', url: 'https://service.somfy.com/downloads/ch_v5/ltrts.pdf' },
    { label: 'Home Assistant — Overkiz integration (RTS covers do not report their state)', url: 'https://www.home-assistant.io/integrations/overkiz/' },
    { label: 'NodeMCU — Somfy module (rolling code)', url: 'https://nodemcu.readthedocs.io/en/latest/modules/somfy/' },
    { label: 'Somfy_Remote_Lib — RTS emulation library (rolling code storage, 433.92 MHz transmitters)', url: 'https://github.com/Legion2/Somfy_Remote_Lib' },
    { label: 'Somfy — Situo RTS manual (adding a remote)', url: 'https://service.somfy.com/downloads/fr_v5/somfynotice_situo_variation_1_soliris_rts.pdf' },
    { label: 'Somfy — Situo 5 io/RTS manual (PROG active for 2 minutes)', url: 'https://service.somfy.com/downloads/fr_v5/5152226asituo_5_io_rts_pure.pdf' },
    { label: 'Somfy — TaHoma Developer Mode (local API)', url: 'https://github.com/Somfy-Developer/Somfy-TaHoma-Developer-Mode' },
    { label: 'Somfy UK — Connexoon apps moved to the TaHoma app', url: 'https://www.somfy.co.uk/support/switch-connexoon-apps-to-tahoma-app' },
    { label: 'Domadoo — Somfy TaHoma Switch (price)', url: 'https://www.domadoo.fr/fr/box-domotique/7532-somfy-box-domotique-somfy-tahoma-switch-rts-io-zigbee-30-1870595-3660849580308.html' },
    { label: 'Mac4Ever — TaHoma Switch launch price', url: 'https://www.mac4ever.com/actu/163481_somfy-devoile-sa-nouvelle-commande-tahoma-switch-compatible-homekit' },
    { label: 'ESPSomfy-RTS — ESP32 + CC1101 firmware', url: 'https://github.com/rstrouse/ESPSomfy-RTS' },
    { label: 'Texas Instruments — CC1101 radio (387–464 MHz)', url: 'https://www.ti.com/product/CC1101' },
    { label: 'RFXCOM — RFXtrx manual (Somfy RTS on the RFXtrx433E only)', url: 'https://www.manualslib.com/manual/872745/Rfxcom-Rfxtrx.html?page=31' },
    { label: 'AZ-Delivery — ESP32 development board (price)', url: 'https://www.az-delivery.de/en/products/esp32-developmentboard' },
    { label: 'RobotShop — Ebyte E07-M1101D-SMA CC1101 module (price)', url: 'https://www.robotshop.com/products/ebyte-e07-m1101d-sma-ebyte-10dbm-530m-cc1101-rf-433mhz-fsk-module' },
    { label: 'Domadoo — RFXCOM RFXtrx433E (price)', url: 'https://www.domadoo.fr/fr/interface-domotique/2561-rfxcom-interface-rfxtrx433e-usb-avec-recepteur-et-emetteur-43392mhz-compatible-somfy-rts.html' },
  ],
  copy: {
    fr: {
      kicker: 'Guide · Somfy RTS',
      title: 'Commander ses volets Somfy RTS sans box.',
      titleAccent: 'sans box',
      lede: 'Volets roulants, stores et screens Somfy RTS depuis votre téléphone et dans vos automatisations, pour une trentaine d’euros de matériel, sans abonnement et sans cloud.',
      problemTitle: 'Le problème',
      problem: [
        'Beaucoup de volets et de stores Somfy se commandent avec une télécommande RTS. Pour les piloter depuis un téléphone, Somfy vend la TaHoma Switch, lancée à 199 € et vendue autour de 175 € [9][10] ; l’ancienne Connexoon RTS a été remplacée et son application fondue dans celle de TaHoma [8].',
        'Beaucoup de foyers n’ont besoin que d’une chose : que les volets obéissent à leurs propres règles. Pour ça, il suffit d’une télécommande de plus, que l’on fabrique.',
      ],
      howTitle: 'Comment marche le RTS',
      how: [
        'Le RTS est une radio à 433,42 MHz [1], à sens unique : le moteur reçoit des ordres mais ne dit jamais où il en est [2]. Chaque ordre porte un compteur qui avance à chaque appui, le « code tournant » ; le moteur refuse un ordre déjà vu, donc enregistrer un signal et le rejouer ne marche pas [3].',
        'En revanche, on peut ajouter une télécommande à un moteur, et c’est prévu par Somfy : on maintient le bouton PROG d’une télécommande déjà associée jusqu’à ce que le volet fasse un petit aller-retour, puis on appuie brièvement sur PROG de la nouvelle [5][6]. Il suffit donc d’un émetteur qui joue le rôle de cette nouvelle télécommande et retient son compteur [4].',
        'Attention à la fréquence : un émetteur 433,92 MHz ordinaire ne fonctionne pas avec le RTS [4]. Le module radio CC1101 se règle par logiciel sur 433,42 MHz [12].',
      ],
      routesTitle: 'Trois façons de faire',
      routes: [
        {
          name: 'Un ESP32 et un module CC1101',
          verdict: 'Local, sans soudure, une trentaine d’euros.',
          recommended: true,
          body: [
            'Le firmware libre ESPSomfy-RTS transforme un ESP32 relié à un module CC1101 en télécommande RTS : interface web, MQTT, jusqu’à 32 volets et 16 groupes [11]. Chaque volet y est associé comme une télécommande de plus, et vos télécommandes continuent de marcher.',
            'Il estime la position de chaque volet à partir du temps de montée et de descente mesuré, et peut entendre les appuis sur vos télécommandes physiques [11]. Le coordinateur Miakapp le pilote par MQTT.',
          ],
          hardware: [
            { item: 'Carte de développement ESP32 [14]', price: '≈ 5 à 13 €' },
            { item: 'Module CC1101 E07-M1101D-SMA avec antenne [15]', price: '≈ 3 à 16 €' },
            { item: 'Fils, alimentation USB, boîtier', price: '≈ 5 à 10 €' },
          ],
          total: '≈ 15 à 40 €',
        },
        {
          name: 'Une clé USB RFXCOM',
          verdict: 'Prête à l’emploi, mais plus chère et difficile à trouver.',
          body: [
            'Branchée sur la machine du coordinateur, la RFXtrx433E pilote le Somfy RTS (pas la RFXtrx433 simple), jusqu’à trente télécommandes virtuelles [13]. Elle sait aussi parler à d’autres appareils 433 MHz de la maison.',
          ],
          hardware: [
            { item: 'RFXCOM RFXtrx433E, souvent en rupture [16]', price: '≈ 110 €' },
          ],
          total: '≈ 110 €',
        },
        {
          name: 'Si vous avez déjà une TaHoma',
          verdict: 'Gardez-la, et passez par son API locale.',
          body: [
            'En mode développeur, la TaHoma ouvre une API locale officielle sur votre réseau, que l’agent interroge depuis le coordinateur [7]. Somfy ne précise pas si les volets RTS y sont tous exposés : l’agent le vérifie sur votre box avant de compter dessus.',
          ],
          hardware: [
            { item: 'Somfy TaHoma Switch [9]', price: '≈ 175 €' },
          ],
          total: 'déjà payée',
        },
      ],
      askTitle: 'Ce que vous pouvez demander ensuite',
      asks: [
        'Ferme les volets au coucher du soleil, sauf ceux de la véranda si quelqu’un y est encore, et ouvre ceux des enfants à 7 h 30 seulement les jours d’école.',
        'Si le vent annoncé dépasse 40 km/h, remonte le store banne, et refuse de le redescendre tant que l’alerte dure.',
        'Mets les volets côté sud en position « my » quand le soleil est sur la façade et qu’il fait plus de 26 °C dedans.',
      ],
      agentTitle: 'Ce que fait l’agent',
      agent: [
        'Il vous dit quoi commander, vérifie que vos télécommandes sont bien RTS et pas io, puis flashe ESPSomfy-RTS sur l’ESP32.',
        'Il vous guide volet par volet pour l’association (PROG sur votre télécommande, puis sur la sienne), chronomètre les courses pour estimer les positions et sauvegarde la configuration, qui contient les compteurs.',
        'Il relie l’ESP32 au coordinateur par MQTT, ajoute les volets et les groupes dans l’app, et écrit les automatisations avec vos sources : soleil, météo, présence, agenda.',
      ],
      caveatsTitle: 'À savoir avant de commencer',
      caveats: [
        'Le RTS est à sens unique : la position affichée est une estimation, qui peut dériver après un obstacle ou un appui que l’émetteur n’a pas entendu, et rien ne confirme qu’un ordre est arrivé [2][11].',
        'Les produits Somfy io-homecontrol ne sont pas du RTS : ils ne s’associent pas ainsi. Regardez l’étiquette de la télécommande, « RTS » ou « io ».',
        'Il faut une télécommande déjà associée pour ajouter l’émetteur [5]. Sans elle, il faut réinitialiser le moteur, et la méthode dépend du modèle.',
        'Sauvegardez la configuration de l’émetteur : elle contient ses compteurs, et les perdre oblige à réassocier chaque volet [4].',
        'Placez l’ESP32 au centre de la maison avec une bonne antenne : murs et volets métalliques réduisent la portée.',
      ],
      pricesNote: 'Prix relevés en novembre 2026 chez des revendeurs européens ; ils varient selon le pays et le moment.',
    },
    en: {
      kicker: 'Guide · Somfy RTS',
      title: 'Control Somfy RTS shutters without a hub.',
      titleAccent: 'without a hub',
      lede: 'Somfy RTS roller shutters, awnings and blinds from your phone and in your automations, for about thirty euros of hardware, with no subscription and no cloud.',
      problemTitle: 'The problem',
      problem: [
        'Many Somfy shutters and awnings are controlled with an RTS remote. To drive them from a phone, Somfy sells the TaHoma Switch, launched at €199 and sold around €175 [9][10]; the older Connexoon RTS has been replaced and its app merged into TaHoma’s [8].',
        'Many homes only need one thing: shutters that follow their own rules. For that, one more remote is enough, and you can build it.',
      ],
      howTitle: 'How RTS works',
      how: [
        'RTS is a 433.42 MHz radio [1], and one-way: the motor receives commands but never says where it is [2]. Every command carries a counter that moves forward with each press, the “rolling code”; the motor rejects a command it has already seen, so recording a signal and replaying it does not work [3].',
        'Adding a remote to a motor, however, is something Somfy designed for: hold PROG on a remote that is already paired until the shutter jogs, then briefly press PROG on the new one [5][6]. All it takes is a transmitter that plays that new remote and remembers its counter [4].',
        'Mind the frequency: an ordinary 433.92 MHz transmitter does not work with RTS [4]. The CC1101 radio module can be tuned to 433.42 MHz in software [12].',
      ],
      routesTitle: 'Three ways to do it',
      routes: [
        {
          name: 'An ESP32 and a CC1101 module',
          verdict: 'Local, no soldering, about thirty euros.',
          recommended: true,
          body: [
            'The open-source ESPSomfy-RTS firmware turns an ESP32 wired to a CC1101 module into an RTS remote: web interface, MQTT, up to 32 shades and 16 groups [11]. Each shutter is paired with it as one more remote, and your remotes keep working.',
            'It estimates each shutter’s position from its measured up and down travel times, and can hear presses on your physical remotes [11]. The Miakapp coordinator drives it over MQTT.',
          ],
          hardware: [
            { item: 'ESP32 development board [14]', price: '≈ €5 to €13' },
            { item: 'CC1101 E07-M1101D-SMA module with antenna [15]', price: '≈ €3 to €16' },
            { item: 'Wires, USB power supply, case', price: '≈ €5 to €10' },
          ],
          total: '≈ €15 to €40',
        },
        {
          name: 'An RFXCOM USB stick',
          verdict: 'Ready to use, but pricier and hard to find.',
          body: [
            'Plugged into the coordinator’s machine, the RFXtrx433E drives Somfy RTS (the plain RFXtrx433 does not), with up to thirty virtual remotes [13]. It can also talk to other 433 MHz devices in the house.',
          ],
          hardware: [
            { item: 'RFXCOM RFXtrx433E, often out of stock [16]', price: '≈ €110' },
          ],
          total: '≈ €110',
        },
        {
          name: 'If you already own a TaHoma',
          verdict: 'Keep it and use its local API.',
          body: [
            'In developer mode, the TaHoma opens an official local API on your network, which the agent queries from the coordinator [7]. Somfy does not say whether every RTS shutter is exposed there: the agent checks on your box before relying on it.',
          ],
          hardware: [
            { item: 'Somfy TaHoma Switch [9]', price: '≈ €175' },
          ],
          total: 'already paid',
        },
      ],
      askTitle: 'What you can ask next',
      asks: [
        'Close the shutters at sunset, except the conservatory ones while someone is still there, and open the kids’ rooms at 7:30 am on school days only.',
        'If the forecast wind goes over 40 km/h, retract the awning and refuse to lower it again while the warning lasts.',
        'Put the south-facing shutters in their “my” position when the sun is on that wall and it is over 26 °C inside.',
      ],
      agentTitle: 'What the agent does',
      agent: [
        'It tells you what to order, checks that your remotes are RTS and not io, then flashes ESPSomfy-RTS onto the ESP32.',
        'It walks you through pairing, shutter by shutter (PROG on your remote, then on its own), times the travel to estimate positions and backs up the configuration, which holds the counters.',
        'It connects the ESP32 to the coordinator over MQTT, adds the shutters and groups to the app, and writes the automations with your sources: sun, weather, presence, calendar.',
      ],
      caveatsTitle: 'Before you start',
      caveats: [
        'RTS is one-way: the position shown is an estimate, which can drift after an obstacle or a press the transmitter did not hear, and nothing confirms a command arrived [2][11].',
        'Somfy io-homecontrol products are not RTS and do not pair this way. Check the remote’s label: “RTS” or “io”.',
        'You need a remote that is already paired to add the transmitter [5]. Without one, the motor must be reset, and how depends on the model.',
        'Back up the transmitter’s configuration: it holds its counters, and losing them means pairing every shutter again [4].',
        'Place the ESP32 centrally with a good antenna: walls and metal shutters reduce range.',
      ],
      pricesNote: 'Prices checked in November 2026 at European retailers; they vary by country and over time.',
    },
  },
};
