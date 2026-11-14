import type { Locale } from '../app/copy';
import { APP_LINKS, contentPage } from './site';
import { Ask, ContentShell, type ContentPageProps } from './site-chrome';

interface Idea {
  readonly ask: string;
  /** What the agent actually builds to honour it: sources, hardware, code. */
  readonly how: string;
}

interface Theme {
  readonly title: string;
  readonly ideas: readonly Idea[];
}

interface IdeasCopy {
  readonly kicker: string;
  readonly title: string;
  readonly titleAccent: string;
  readonly lede: readonly string[];
  readonly ruleTitle: string;
  readonly rule: string;
  readonly ruleExample: string;
  readonly ruleAfter: string;
  readonly agentLabel: string;
  readonly themes: readonly Theme[];
  readonly limitsTitle: string;
  readonly limits: readonly { readonly title: string; readonly body: string }[];
  readonly closingTitle: string;
  readonly closingBody: string;
  readonly closingCta: string;
  readonly closingLink: string;
}

const FR: IdeasCopy = {
  kicker: 'Idées',
  title: 'Ce que vous pouvez demander à votre agent.',
  titleAccent: 'demander',
  lede: [
    '« Ferme les volets tous les jours à 20 h » ? Un minuteur à quinze euros sait le faire. Votre agent écrit du code : il lit la météo et votre agenda, apprend les signaux d’une télécommande, explore l’API d’un fabricant et dessine un écran pour chaque habitant.',
    'Voici de quoi commencer. La seule vraie limite, c’est ce que vous aurez l’idée de demander.',
  ],
  ruleTitle: 'La règle du jeu',
  rule: 'Une bonne demande dit le résultat attendu, les exceptions et pour qui. Le minimum ressemble à ceci :',
  ruleExample: 'Ferme les volets au coucher du soleil, sauf si quelqu’un est encore dans la véranda.',
  ruleAfter: 'Les demandes ci-dessous vont beaucoup plus loin : elles croisent des sources extérieures, des déclencheurs, des appareils qui n’ont jamais été prévus pour être connectés et des interfaces faites pour une seule personne.',
  agentLabel: 'Ce que fait l’agent',
  themes: [
    {
      title: 'Énergie et tarifs',
      ideas: [
        {
          ask: 'Les jours rouges Tempo, préchauffe la maison pendant les heures creuses de la nuit, coupe le chauffe-eau jusqu’au soir, et préviens-moi la veille avec ce que ça nous fait économiser.',
          how: 'Il récupère la couleur du lendemain, publiée la veille par RTE, programme le chauffage et un relais sur le chauffe-eau, et calcule l’économie avec les prix de votre contrat avant d’envoyer la notification.',
        },
        {
          ask: 'Charge la voiture pour qu’elle soit à 80 % à 7 h 30 : d’abord avec le surplus des panneaux, puis en heures creuses, et jamais un jour rouge.',
          how: 'Il lit la production de l’onduleur (souvent en Modbus TCP ou par une API locale) et la consommation de la maison, pilote la borne (beaucoup parlent OCPP) ou l’API du véhicule, et recalcule son plan à chaque nuage.',
        },
        {
          ask: 'Lis le compteur Linky en direct et montre-moi chaque soir ce qu’a coûté la journée, appareil par appareil, avec la facture prévue pour le mois.',
          how: 'Il fait brancher un petit module sur la sortie téléinformation (TIC) du Linky, ajoute des prises qui mesurent la consommation, puis écrit l’écran Énergie et la projection.',
        },
        {
          ask: 'Si la maison dépasse 6 kVA, coupe d’abord le chauffe-eau, puis les radiateurs des chambres, avant que le disjoncteur ne saute.',
          how: 'Il lit la puissance instantanée sur la TIC, délieste dans l’ordre que vous avez choisi et rétablit tout quand la charge redescend.',
        },
      ],
    },
    {
      title: 'Météo et soleil',
      ideas: [
        {
          ask: 'Ferme les volets côté sud quand le soleil tape sur la façade et qu’il fait plus de 26 °C dehors ; rouvre-les dès qu’il fait plus frais dehors que dedans. Sauf dans le bureau quand je suis en visio.',
          how: 'Il calcule la position du soleil pour votre adresse et l’orientation de chaque façade, compare les capteurs intérieurs et extérieurs, et lit votre agenda pour repérer les visios.',
        },
        {
          ask: 'Si le vent annoncé dépasse 50 km/h dans l’heure, remonte le store banne, même si personne n’est là, et préviens-moi.',
          how: 'Il interroge un service de prévision (Open-Meteo, Météo-France…) toutes les quelques minutes, ou un anémomètre si vous en avez un, et garde une trace de chaque décision dans l’app.',
        },
        {
          ask: 'N’arrose le potager que si la terre est sèche et qu’il ne va pas pleuvoir dans les 24 heures, et adapte la durée à la chaleur du jour.',
          how: 'Un capteur d’humidité du sol, les prévisions de pluie, une électrovanne, et un historique des arrosages pour vérifier qu’il ne s’est pas trompé.',
        },
        {
          ask: 'Quand Météo-France place le département en vigilance orange orages, rentre le store, ferme les fenêtres de toit et préviens toute la maison.',
          how: 'Il suit le flux de vigilance de Météo-France pour votre département et déclenche ce scénario, une seule fois par alerte.',
        },
      ],
    },
    {
      title: 'Présence, agenda, trajets',
      ideas: [
        {
          ask: 'Quand je quitte le bureau et qu’il fait moins de 19 °C à la maison, lance le chauffage pour que j’arrive au chaud. Si mon agenda dit que je dors à l’hôtel, ne fais rien.',
          how: 'Il installe avec vous une app de géolocalisation ouverte comme OwnTracks, définit les zones, lit votre agenda Google ou iCloud et estime le temps de chauffe d’après l’historique de la maison.',
        },
        {
          ask: 'Les matins où j’ai une réunion avant 8 h 30, avance le réveil lumineux et la machine à café d’une demi-heure.',
          how: 'Il lit l’agenda chaque soir, recale les horaires du lendemain et vous le dit dans l’app, pour que vous puissiez dire non.',
        },
        {
          ask: 'Quand le dernier habitant part et qu’une fenêtre reste ouverte, envoie-lui une notification ; s’il ne fait rien dans les dix minutes, coupe le chauffage de la pièce.',
          how: 'Il déduit la présence des téléphones et des capteurs, sait qui est parti en dernier et lui adresse la notification à lui seul.',
        },
        {
          ask: 'Pendant nos vacances, fais vivre la maison comme nous : lumières, volets et télé aux heures où nous les utilisons vraiment, pas tous les jours à la même minute.',
          how: 'Il rejoue l’historique des semaines précédentes avec un peu de hasard, et s’arrête dès qu’un habitant rentre.',
        },
      ],
    },
    {
      title: 'Appareils fermés, sans API',
      ideas: [
        {
          ask: 'La clim n’a qu’une télécommande infrarouge. Je veux la piloter depuis l’app, avec la vraie consigne et le mode, et qu’elle se coupe si la fenêtre est ouverte.',
          how: 'Il fait poser un émetteur infrarouge (un ESP32 sous ESPHome ou un boîtier Broadlink), capture ou retrouve les trames de la télécommande, puis tient lui-même l’état, puisque l’infrarouge ne renvoie rien.',
        },
        {
          ask: 'Le portail a une télécommande 433 MHz. Ajoute un bouton portail sur l’écran de chacun ; les invités ne l’ont qu’entre 8 h et 20 h.',
          how: 'Il identifie le codage avec un récepteur radio. Code fixe : un émetteur 433 MHz suffit. Code tournant : il ne le clone pas et propose de câbler un relais sur l’entrée bouton de la carte du moteur, souvent prévue pour ça.',
        },
        {
          ask: 'Les volets Somfy n’ont que des télécommandes RTS. Je veux les commander sans racheter de box.',
          how: 'Un émetteur 433,42 MHz piloté par un ESP32, enregistré comme télécommande supplémentaire de chaque volet. Les vôtres continuent de marcher.',
        },
        {
          ask: 'Le chauffe-eau thermodynamique ne se pilote que par l’app du fabricant. Ramène sa température et son mode dans Miakapp.',
          how: 'Avec votre compte, il observe ce que l’app échange avec le serveur du fabricant, retrouve les appels utiles et les rejoue depuis le coordinateur. Il vous prévient si une mise à jour les casse.',
        },
        {
          ask: 'Le vieux sèche-linge n’a rien de connecté. Préviens celui qui l’a lancé quand il a fini.',
          how: 'Une prise qui mesure la puissance : quand la consommation retombe et y reste, le cycle est fini, et la notification part vers la personne qui a touché « je lance une machine » dans l’app.',
        },
      ],
    },
    {
      title: 'Un écran pour chacun',
      ideas: [
        {
          ask: 'Pour notre fille de 7 ans : trois gros boutons illustrés, sa lampe, ses volets et l’histoire du soir sur l’enceinte. Rien d’autre, et plus rien après 21 h.',
          how: 'Une interface à part pour son compte, avec ses droits à elle, vérifiés par le coordinateur et pas seulement cachés à l’écran.',
        },
        {
          ask: 'Pour mon père, qui voit mal : une page en très gros caractères avec le chauffage de sa chambre et un bouton qui m’envoie une notification.',
          how: 'Une mise en page à fort contraste, deux commandes, et une notification qui arrive sur votre téléphone avec son nom.',
        },
        {
          ask: 'Sur la tablette de l’entrée : la météo des deux prochaines heures, qui est à la maison, le jour des poubelles d’après le calendrier de la commune, et un bouton « tout éteindre » en sortant.',
          how: 'Il récupère le calendrier de collecte sur le site de votre commune, combine présence et prévisions, et fait un écran pensé pour être lu à trois mètres.',
        },
        {
          ask: 'Pour les locataires du gîte : un accès du vendredi au dimanche, le code Wi-Fi, le mode d’emploi de la clim et le chauffage de leur étage, rien de plus.',
          how: 'Un accès qui expire tout seul, un écran d’accueil dans leur langue, et des droits limités à leur étage.',
        },
        {
          ask: 'Pour moi : un écran façon cockpit, toutes les mesures, des courbes sur trente jours et le journal de tout ce que la maison a décidé.',
          how: 'Le même coordinateur, une interface entièrement différente. L’agent écrit le HTML, le CSS et les graphiques qu’il faut.',
        },
      ],
    },
    {
      title: 'Veiller sur la maison',
      ideas: [
        {
          ask: 'Si le congélateur dépasse −12 °C plus de vingt minutes, préviens tout le monde, puis relance toutes les heures jusqu’à ce que quelqu’un s’en occupe.',
          how: 'Une sonde de température, une alerte qui ne s’arrête que quand quelqu’un l’a acquittée dans l’app.',
        },
        {
          ask: 'La nuit, si l’eau coule sans arrêt pendant deux heures, ferme la vanne générale et réveille-moi.',
          how: 'Un compteur d’eau à impulsions ou un débitmètre, une électrovanne motorisée, et une notification qui sonne.',
        },
        {
          ask: 'Préviens-moi quand la pile d’un capteur passe sous 20 %, avec la référence exacte à acheter.',
          how: 'Il suit le niveau de chaque capteur et connaît le modèle de chacun, donc sa pile.',
        },
        {
          ask: 'Regarde ce qu’on fait à la main tous les jours depuis un mois et propose-moi les automatisations qui manquent.',
          how: 'Il lit l’historique des commandes, repère les gestes répétés et vous propose de les automatiser, un par un, sans rien activer sans votre accord.',
        },
      ],
    },
  ],
  limitsTitle: 'Les vraies limites',
  limits: [
    { title: 'Il faut parfois du matériel', body: 'Un émetteur radio ou infrarouge, un relais, un capteur. L’agent vous dit lequel, pourquoi, et préfère ce qui marche en local.' },
    { title: 'Tout ne se clone pas', body: 'Les codes tournants et les serrures sécurisées sont faits pour résister. L’agent passe alors par un contact câblé ou une intégration officielle ; il ne contourne pas une sécurité.' },
    { title: 'Un cloud fermé peut changer', body: 'Une API non documentée peut casser à la prochaine mise à jour du fabricant. L’agent vous prévient et choisit une solution locale quand elle existe.' },
    { title: 'Les gestes qui comptent restent à vous', body: 'Ouvrir, verrouiller, chauffer : l’agent n’accorde ces droits que si vous les avez demandés, et seulement à qui vous les avez demandés.' },
  ],
  closingTitle: 'Votre première demande ?',
  closingBody: 'Créez la maison, connectez votre agent, et commencez par ce qui vous agace le plus.',
  closingCta: 'Créer ma maison',
  closingLink: 'Comment ça marche',
};

const EN: IdeasCopy = {
  kicker: 'Ideas',
  title: 'What you can ask your agent.',
  titleAccent: 'ask',
  lede: [
    '“Close the shutters every day at 8 pm”? A fifteen-dollar timer does that. Your agent writes code: it reads the weather and your calendar, learns the signals of a remote, explores a manufacturer’s API and designs a screen for each person in the house.',
    'Here is something to start with. The only real limit is what you think of asking.',
  ],
  ruleTitle: 'The rule of the game',
  rule: 'A good request says what you want, the exceptions and for whom. The bare minimum looks like this:',
  ruleExample: 'Close the shutters at sunset, unless someone is still in the conservatory.',
  ruleAfter: 'The requests below go much further: they combine outside sources, triggers, devices never meant to be connected and interfaces made for a single person.',
  agentLabel: 'What the agent does',
  themes: [
    {
      title: 'Energy and tariffs',
      ideas: [
        {
          ask: 'On Tempo red days, preheat the house during the night’s off-peak hours, switch the water heater off until the evening, and tell me the day before how much it saves us.',
          how: 'Tempo is a French tariff with 22 very expensive days a year, announced the day before by RTE, the grid operator. The agent fetches tomorrow’s colour, schedules the heating and a relay on the water heater, and computes the saving from your contract’s prices before sending the notification.',
        },
        {
          ask: 'Charge the car to 80% by 7:30 am: solar surplus first, then off-peak hours, and never on a red day.',
          how: 'It reads the inverter’s output (often over Modbus TCP or a local API) and the home’s consumption, drives the charger (many speak OCPP) or the car’s API, and recomputes its plan with every cloud.',
        },
        {
          ask: 'Read the electricity meter live and show me every evening what the day cost, device by device, with the projected bill for the month.',
          how: 'It has a small module plugged into the meter’s data output (the TIC port on a French Linky meter), adds plugs that measure consumption, then writes the Energy screen and the projection.',
        },
        {
          ask: 'If the house goes over 6 kVA, cut the water heater first, then the bedroom radiators, before the main breaker trips.',
          how: 'It reads the instantaneous power from the meter, sheds load in the order you chose and restores everything when the load drops.',
        },
      ],
    },
    {
      title: 'Weather and sun',
      ideas: [
        {
          ask: 'Close the south-facing shutters when the sun hits that wall and it is over 26 °C outside; open them again as soon as it is cooler outside than inside. Except in the study while I am on a video call.',
          how: 'It computes the sun’s position for your address and the orientation of each wall, compares indoor and outdoor sensors, and reads your calendar to spot video calls.',
        },
        {
          ask: 'If the forecast wind goes over 50 km/h within the hour, retract the awning, even if nobody is home, and let me know.',
          how: 'It polls a forecast service (Open-Meteo, a national weather service…) every few minutes, or an anemometer if you have one, and logs every decision in the app.',
        },
        {
          ask: 'Only water the vegetable patch if the soil is dry and no rain is expected in the next 24 hours, and adjust the duration to the day’s heat.',
          how: 'A soil moisture sensor, the rain forecast, a solenoid valve, and a watering history to check it got it right.',
        },
        {
          ask: 'When the weather service issues an orange storm warning for our area, retract the awning, close the roof windows and warn the whole house.',
          how: 'It follows the official warning feed for your area and runs this scenario once per warning.',
        },
      ],
    },
    {
      title: 'Presence, calendar, commutes',
      ideas: [
        {
          ask: 'When I leave the office and it is under 19 °C at home, start the heating so the house is warm when I arrive. If my calendar says I am staying at a hotel, do nothing.',
          how: 'It sets up an open location app such as OwnTracks with you, defines the zones, reads your Google or iCloud calendar and estimates the warm-up time from the home’s history.',
        },
        {
          ask: 'On mornings when I have a meeting before 8:30, bring the wake-up light and the coffee machine forward by half an hour.',
          how: 'It reads the calendar every evening, shifts the next day’s times and tells you in the app, so you can say no.',
        },
        {
          ask: 'When the last person leaves and a window is still open, send them a notification; if they do nothing within ten minutes, turn the heating off in that room.',
          how: 'It infers presence from phones and sensors, knows who left last and notifies that person only.',
        },
        {
          ask: 'While we are on holiday, make the house live like we do: lights, shutters and TV at the times we really use them, not at the same minute every day.',
          how: 'It replays the previous weeks’ history with a little randomness, and stops as soon as someone comes home.',
        },
      ],
    },
    {
      title: 'Closed devices with no API',
      ideas: [
        {
          ask: 'The air conditioner only has an infrared remote. I want to control it from the app, with the real set point and mode, and have it switch off when the window is open.',
          how: 'It has you install an infrared transmitter (an ESP32 running ESPHome or a Broadlink box), captures or looks up the remote’s codes, then keeps track of the state itself, since infrared sends nothing back.',
        },
        {
          ask: 'The gate has a 433 MHz remote. Add a gate button to everyone’s screen; guests only get it between 8 am and 8 pm.',
          how: 'It identifies the encoding with a radio receiver. Fixed code: a 433 MHz transmitter is enough. Rolling code: it does not clone it, and suggests wiring a relay to the push-button input of the motor’s board, which is often there for that purpose.',
        },
        {
          ask: 'The Somfy shutters only have RTS remotes. I want to control them without buying another hub.',
          how: 'A 433.42 MHz transmitter driven by an ESP32, registered as an additional remote for each shutter. Your remotes keep working.',
        },
        {
          ask: 'The heat-pump water heater can only be controlled from the manufacturer’s app. Bring its temperature and mode into Miakapp.',
          how: 'With your account, it observes what the app exchanges with the manufacturer’s server, finds the useful calls and replays them from the coordinator. It warns you if an update breaks them.',
        },
        {
          ask: 'The old tumble dryer has nothing connected. Tell whoever started it when it is done.',
          how: 'A plug that measures power: when consumption drops and stays low, the cycle is over, and the notification goes to the person who tapped “starting a load” in the app.',
        },
      ],
    },
    {
      title: 'A screen for each person',
      ideas: [
        {
          ask: 'For our 7-year-old: three big illustrated buttons, her lamp, her shutters and the bedtime story on the speaker. Nothing else, and nothing after 9 pm.',
          how: 'A separate interface for her account, with her own rights, enforced by the coordinator rather than just hidden on screen.',
        },
        {
          ask: 'For my father, whose eyesight is poor: a page in very large type with his bedroom heating and a button that sends me a notification.',
          how: 'A high-contrast layout, two controls, and a notification that reaches your phone with his name on it.',
        },
        {
          ask: 'On the hallway tablet: the weather for the next two hours, who is home, bin day from the town’s collection calendar, and an “everything off” button on the way out.',
          how: 'It fetches the collection calendar from your town’s website, combines presence and forecast, and builds a screen meant to be read from three metres away.',
        },
        {
          ask: 'For the holiday rental guests: access from Friday to Sunday, the Wi-Fi password, how to use the air conditioning and the heating of their floor, nothing more.',
          how: 'Access that expires on its own, a welcome screen in their language, and rights limited to their floor.',
        },
        {
          ask: 'For me: a cockpit-style screen, every measurement, thirty-day charts and the log of everything the house decided.',
          how: 'The same coordinator, an entirely different interface. The agent writes the HTML, CSS and charts it takes.',
        },
      ],
    },
    {
      title: 'Watching over the house',
      ideas: [
        {
          ask: 'If the freezer goes above −12 °C for more than twenty minutes, warn everyone, then remind us every hour until someone deals with it.',
          how: 'A temperature probe and an alert that only stops once someone has acknowledged it in the app.',
        },
        {
          ask: 'At night, if water keeps running for two hours, close the main valve and wake me up.',
          how: 'A pulse water meter or a flow sensor, a motorised valve, and a notification that rings.',
        },
        {
          ask: 'Tell me when a sensor’s battery drops below 20%, with the exact battery to buy.',
          how: 'It tracks every sensor’s level and knows each model, so its battery.',
        },
        {
          ask: 'Look at what we have done by hand every day for the past month and suggest the automations we are missing.',
          how: 'It reads the command history, spots repeated actions and offers to automate them one at a time, without enabling anything until you agree.',
        },
      ],
    },
  ],
  limitsTitle: 'The real limits',
  limits: [
    { title: 'Sometimes you need hardware', body: 'A radio or infrared transmitter, a relay, a sensor. The agent tells you which one, why, and prefers what works locally.' },
    { title: 'Not everything can be cloned', body: 'Rolling codes and secure locks are designed to resist. The agent then goes through a wired contact or an official integration; it does not bypass a security measure.' },
    { title: 'A closed cloud can change', body: 'An undocumented API can break with the manufacturer’s next update. The agent warns you and picks a local option when there is one.' },
    { title: 'The actions that matter stay yours', body: 'Opening, locking, heating: the agent only grants those rights if you asked, and only to the people you named.' },
  ],
  closingTitle: 'Your first request?',
  closingBody: 'Create the home, connect your agent, and start with what annoys you most.',
  closingCta: 'Create my home',
  closingLink: 'How it works',
};

const COPY: Record<Locale, IdeasCopy> = { en: EN, fr: FR };

function Title({ copy }: { readonly copy: IdeasCopy }): React.JSX.Element {
  const at = copy.title.indexOf(copy.titleAccent);
  return (
    <h1>
      {copy.title.slice(0, at)}<em>{copy.titleAccent}</em>{copy.title.slice(at + copy.titleAccent.length)}
    </h1>
  );
}

export function IdeasPage({ locale }: ContentPageProps): React.JSX.Element {
  const copy = COPY[locale];
  return (
    <ContentShell id="ideas" locale={locale}>
      <header className="content-hero">
        <p className="product-kicker glass"><span /> {copy.kicker}</p>
        <Title copy={copy} />
        {copy.lede.map((paragraph) => <p className="content-lede" key={paragraph}>{paragraph}</p>)}
      </header>

      <section className="content-section">
        <h2>{copy.ruleTitle}</h2>
        <p>{copy.rule}</p>
        <Ask locale={locale}>{copy.ruleExample}</Ask>
        <p>{copy.ruleAfter}</p>
        <nav className="content-toc" aria-label={copy.kicker}>
          {copy.themes.map((theme, index) => <a href={`#theme-${index + 1}`} key={theme.title}>{theme.title}</a>)}
        </nav>
      </section>

      {copy.themes.map((theme, index) => (
        <section className="content-section" id={`theme-${index + 1}`} key={theme.title}>
          <h2>{theme.title}</h2>
          <div className="content-ideas">
            {theme.ideas.map((idea) => (
              <article className="glass" key={idea.ask}>
                <Ask locale={locale}>{idea.ask}</Ask>
                <p><strong>{copy.agentLabel} · </strong>{idea.how}</p>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="content-section">
        <h2>{copy.limitsTitle}</h2>
        <div className="landing-grid landing-grid--four">
          {copy.limits.map((limit) => (
            <article className="glass" key={limit.title}>
              <strong>{limit.title}</strong>
              <p>{limit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-closing content-closing">
        <div>
          <h2>{copy.closingTitle}</h2>
          <p>{copy.closingBody}</p>
        </div>
        <div className="content-closing__actions">
          <a className="product-button product-button--light" href={APP_LINKS.newHome}>{copy.closingCta} <span aria-hidden="true">→</span></a>
          <a className="content-closing__link" href={contentPage('how-it-works').path[locale]}>{copy.closingLink}</a>
        </div>
      </section>
    </ContentShell>
  );
}
