import { APP_LINKS, contentPage, SOURCE_URL } from './site';
import { ContentShell, type ContentPageProps } from './site-chrome';

function Flow({ steps }: { readonly steps: readonly { readonly name: string; readonly where: string; readonly body: string }[] }): React.JSX.Element {
  return (
    <ol className="content-flow">
      {steps.map((step) => (
        <li className="glass" key={step.name}>
          <small>{step.where}</small>
          <strong>{step.name}</strong>
          <p>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

function French(): React.JSX.Element {
  return (
    <>
      <header className="content-hero">
        <p className="product-kicker glass"><span /> Comment ça marche</p>
        <h1>Miakapp fait quatre choses. <em>Votre agent fait tout le reste.</em></h1>
        <p className="content-lede">
          Miakapp ne contient aucune intégration d’appareil, aucun moteur de règles et aucun tableau de bord
          tout fait. C’est un socle : il héberge l’app de votre maison, connecte ses habitants, envoie les
          notifications et continue de marcher quand Internet tombe. Les appareils, les automatisations et
          l’interface, c’est l’agent qui les construit, pour votre maison et personne d’autre.
        </p>
      </header>

      <section className="content-section">
        <h2>Le chemin d’un clic</h2>
        <p>
          Quatre pièces, dont deux écrites par votre agent. Quand quelqu’un touche un bouton dans l’app, l’appel
          traverse le relais jusqu’au coordinateur, qui décide s’il a le droit, agit sur l’appareil, puis publie le
          nouvel état que toutes les apps ouvertes affichent aussitôt.
        </p>
        <Flow
          steps={[
            { where: 'Chez vous', name: 'Les appareils', body: 'Zigbee, MQTT, Wi-Fi, radio 433 MHz, infrarouge, API cloud d’un fabricant… peu importe.' },
            { where: 'Chez vous · écrit par l’agent', name: 'Le coordinateur', body: 'Un programme TypeScript qui tourne en continu sur un Raspberry Pi ou un mini-PC. Il parle aux appareils, tient l’état de la maison et décide qui a le droit de faire quoi.' },
            { where: 'Miakapp', name: 'Le relais', body: 'Il relie le coordinateur aux habitants, où qu’ils soient, et garde le dernier état connu.' },
            { where: 'Sur chaque téléphone · écrite par l’agent', name: 'L’app de la maison', body: 'Une vraie application web, dessinée pour votre maison, et au besoin pour chaque habitant.' },
          ]}
        />
      </section>

      <section className="content-section">
        <h2>Ce dont Miakapp se charge</h2>
        <div className="content-cards">
          <article className="glass">
            <h3>1. Héberger l’app de la maison</h3>
            <p>
              L’interface est une application web complète : HTML, CSS, JavaScript, les bibliothèques que l’agent
              juge utiles. Il la compile en un seul fichier et la publie avec <code>miakapp publish</code>. Miakapp la
              sert sur www.miakapp.com, dans un cadre isolé sur une origine séparée : elle n’a ni accès réseau ni
              stockage partagé, et ne parle à la maison que par le pont <code>window.miakapp</code>. Chaque
              publication est versionnée et se défait en une commande.
            </p>
            <p>
              Le <strong>relais WebSocket</strong> fait le lien. C’est le coordinateur qui ouvre la connexion, vers
              l’extérieur : aucun port à ouvrir sur la box, pas besoin d’adresse IP fixe. Le relais garde en cache le
              dernier état publié, donc l’app s’ouvre tout de suite avec les dernières valeurs connues et signale
              celles qui ne sont plus fraîches au lieu de les faire passer pour actuelles. Il route chaque appel vers
              le coordinateur qui l’a déclaré.
            </p>
            <p className="content-note">
              Pour être précis : le relais termine la connexion chiffrée et voit l’état en clair. Ce n’est pas du
              chiffrement de bout en bout, et nous ne le présentons pas comme tel.
            </p>
          </article>
          <article className="glass">
            <h3>2. Connecter les habitants</h3>
            <p>
              Chaque habitant a son compte Miakapp : connexion avec Google ou par un lien envoyé par email, sans mot
              de passe à retenir. Une même personne peut appartenir à plusieurs maisons.
            </p>
            <p>
              À chaque appel, le relais joint l’identité vérifiée de la personne, que l’app ne peut pas falsifier.
              Ce qu’elle a le droit de faire, c’est le coordinateur qui le décide, donc l’agent, selon ce que vous lui
              avez demandé : « les enfants ne touchent pas au chauffage », « les invités ouvrent le portail de 8 h à
              20 h ».
            </p>
            <p>
              L’agent, lui, n’a jamais votre mot de passe. Vous lui donnez accès à une maison depuis
              miakapp.com/pair, avec un code à usage unique valable dix minutes. Il reçoit sa propre clé, que vous
              révoquez quand vous voulez sans toucher aux autres.
            </p>
          </article>
          <article className="glass">
            <h3>3. Envoyer les notifications</h3>
            <p>
              Des notifications push sur Android, sur ordinateur et sur iPhone, une fois Miakapp ajouté à l’écran
              d’accueil. Aucune application à installer depuis un store. L’agent les envoie depuis le coordinateur
              (« le congélateur remonte à −12 °C ») ou d’une commande, <code>miakapp notify</code>.
            </p>
          </article>
          <article className="glass">
            <h3>4. Tenir sans Internet</h3>
            <p>
              Si la connexion de la maison ou le relais tombe, le coordinateur sert la même app directement sur le
              réseau local, sans relais ni cloud, avec un jeton d’accès s’il le faut. L’app n’a pas besoin d’être
              modifiée : le pont <code>window.miakapp</code> est le même. Gardez l’adresse locale en favori, elle
              sert le jour où la box redémarre en boucle.
            </p>
          </article>
        </div>
      </section>

      <section className="content-section">
        <h2>Ce que construit votre agent</h2>
        <p>Tout ce qui fait votre maison, et qui ne ressemble à aucune autre :</p>
        <ul className="content-list">
          <li><strong>Conseiller le matériel.</strong> Plutôt des protocoles locaux et ouverts (Zigbee, MQTT, Tasmota, ESPHome), qui marchent sans le cloud du fabricant.</li>
          <li><strong>Relier les appareils, même fermés.</strong> Une télécommande radio 433 MHz, une clim infrarouge, une application cloud sans API publique : l’agent cherche comment l’appareil communique et s’y branche.</li>
          <li><strong>Écrire le coordinateur.</strong> Les intégrations, les automatisations, les droits de chaque habitant, avec des tests.</li>
          <li><strong>Dessiner l’interface.</strong> Un écran pour la famille, un autre pour les enfants, un pour la tablette de l’entrée, dans le style que vous voulez.</li>
          <li><strong>La faire évoluer.</strong> Vous demandez, il modifie, il publie, il vérifie sur l’app réelle.</li>
        </ul>
      </section>

      <section className="content-section">
        <h2>Pourquoi un socle si petit ?</h2>
        <p>
          Les plateformes domotiques classiques essaient de tout prévoir : des milliers d’intégrations, un éditeur
          de règles, des cartes de tableau de bord. Chacune de ces briques est aussi une limite : ce que l’éditeur
          ne sait pas exprimer, vous ne pouvez pas le faire. Un agent qui écrit du code n’a pas besoin de ces
          béquilles. Miakapp garde seulement ce qui serait pénible ou risqué à refaire dans chaque maison :
          l’hébergement, l’identité des habitants, les notifications et la résilience.
        </p>
      </section>

      <section className="content-section">
        <h2>Ce qu’il vous faut</h2>
        <ul className="content-list">
          <li><strong>Un agent de code.</strong> Un agent molted.cloud, Claude Code, Codex ou un autre : la CLI <code>@miakapp/cli</code> et son guide suffisent.</li>
          <li><strong>Une machine allumée en permanence chez vous</strong> pour le coordinateur : un Raspberry Pi ou un mini-PC.</li>
          <li><strong>Un compte Miakapp</strong>, pour créer la maison et y inviter les habitants.</li>
        </ul>
        <p>Le code de Miakapp est public : <a href={SOURCE_URL} rel="noopener">github.com/Miakapp/Miakapp</a>.</p>
      </section>

      <section className="landing-closing content-closing">
        <div>
          <h2>Et maintenant, quoi lui demander ?</h2>
          <p>Des demandes qu’aucun éditeur de règles ne sait écrire.</p>
        </div>
        <div className="content-closing__actions">
          <a className="product-button product-button--light" href={contentPage('ideas').path.fr}>Voir les idées <span aria-hidden="true">→</span></a>
          <a className="content-closing__link" href={APP_LINKS.newHome}>Créer ma maison</a>
        </div>
      </section>
    </>
  );
}

function English(): React.JSX.Element {
  return (
    <>
      <header className="content-hero">
        <p className="product-kicker glass"><span /> How it works</p>
        <h1>Miakapp does four things. <em>Your agent does the rest.</em></h1>
        <p className="content-lede">
          Miakapp ships no device integration, no rule engine and no ready-made dashboard. It is a foundation: it
          hosts your home’s app, signs in the people who live there, sends notifications and keeps working when
          the internet goes down. The devices, the automations and the interface are built by your agent, for
          your home and nobody else’s.
        </p>
      </header>

      <section className="content-section">
        <h2>The path of a tap</h2>
        <p>
          Four pieces, two of them written by your agent. When someone taps a button in the app, the call goes
          through the relay to the coordinator, which decides whether that person may do it, acts on the device,
          then publishes the new state every open app shows at once.
        </p>
        <Flow
          steps={[
            { where: 'At home', name: 'The devices', body: 'Zigbee, MQTT, Wi-Fi, 433 MHz radio, infrared, a manufacturer’s cloud API… it does not matter.' },
            { where: 'At home · written by the agent', name: 'The coordinator', body: 'A TypeScript program running around the clock on a Raspberry Pi or a mini PC. It talks to the devices, holds the home’s state and decides who may do what.' },
            { where: 'Miakapp', name: 'The relay', body: 'It connects the coordinator to the people of the home, wherever they are, and keeps the last known state.' },
            { where: 'On every phone · written by the agent', name: 'The home’s app', body: 'A real web application, designed for your home, and for each person in it if needed.' },
          ]}
        />
      </section>

      <section className="content-section">
        <h2>What Miakapp takes care of</h2>
        <div className="content-cards">
          <article className="glass">
            <h3>1. Hosting the home’s app</h3>
            <p>
              The interface is a complete web application: HTML, CSS, JavaScript, whatever libraries the agent finds
              useful. It bundles it into one file and publishes it with <code>miakapp publish</code>. Miakapp serves it
              on www.miakapp.com in an isolated frame on a separate origin: it has no network access and no shared
              storage, and talks to the home only through the <code>window.miakapp</code> bridge. Every publication is
              versioned and can be undone in one command.
            </p>
            <p>
              The <strong>WebSocket relay</strong> connects the pieces. The coordinator opens the connection, outbound:
              no port to open on your router, no fixed IP address. The relay caches the last published state, so the
              app opens at once with the last known values and flags the ones that are no longer fresh instead of
              passing them off as current. It routes every call to the coordinator that declared it.
            </p>
            <p className="content-note">
              To be precise: the relay terminates the encrypted connection and sees the state in plain text. This is
              not end-to-end encryption, and we do not present it as such.
            </p>
          </article>
          <article className="glass">
            <h3>2. Signing people in</h3>
            <p>
              Everyone in the home has their own Miakapp account: sign in with Google or with a link sent by email, no
              password to remember. One person can belong to several homes.
            </p>
            <p>
              With every call, the relay attaches the person’s verified identity, which the app cannot forge. What they
              may do is decided by the coordinator, so by the agent, following what you asked: “the kids don’t touch
              the heating”, “guests can open the gate from 8 am to 8 pm”.
            </p>
            <p>
              The agent never has your password. You give it access to one home from miakapp.com/pair, with a
              single-use code valid for ten minutes. It gets its own key, which you can revoke at any time without
              touching the others.
            </p>
          </article>
          <article className="glass">
            <h3>3. Push notifications</h3>
            <p>
              Push notifications on Android, on computers and on iPhone once Miakapp is added to the Home Screen. No
              app to install from a store. The agent sends them from the coordinator (“the freezer is up to −12 °C”) or
              with one command, <code>miakapp notify</code>.
            </p>
          </article>
          <article className="glass">
            <h3>4. Working without the internet</h3>
            <p>
              If the home’s connection or the relay goes down, the coordinator serves the same app directly on the
              local network, without the relay or any cloud, behind an access token if needed. The app needs no change:
              the <code>window.miakapp</code> bridge is the same. Bookmark the local address; it is the one you need the
              day the router keeps rebooting.
            </p>
          </article>
        </div>
      </section>

      <section className="content-section">
        <h2>What your agent builds</h2>
        <p>Everything that makes your home yours, and like no other:</p>
        <ul className="content-list">
          <li><strong>Advising on hardware.</strong> Preferably local, open protocols (Zigbee, MQTT, Tasmota, ESPHome) that work without the manufacturer’s cloud.</li>
          <li><strong>Connecting devices, even closed ones.</strong> A 433 MHz radio remote, an infrared air conditioner, a cloud app with no public API: the agent finds out how the device communicates and plugs into it.</li>
          <li><strong>Writing the coordinator.</strong> Integrations, automations, each person’s rights, with tests.</li>
          <li><strong>Designing the interface.</strong> One screen for the family, another for the kids, one for the hallway tablet, in whatever style you like.</li>
          <li><strong>Keeping it moving.</strong> You ask, it changes the code, publishes and checks the result in the real app.</li>
        </ul>
      </section>

      <section className="content-section">
        <h2>Why such a small foundation?</h2>
        <p>
          Classic home automation platforms try to anticipate everything: thousands of integrations, a rule editor,
          dashboard cards. Each of those pieces is also a limit: whatever the editor cannot express, you cannot do.
          An agent that writes code does not need those crutches. Miakapp keeps only what would be tedious or risky
          to rebuild in every home: hosting, the identity of the people who live there, notifications and resilience.
        </p>
      </section>

      <section className="content-section">
        <h2>What you need</h2>
        <ul className="content-list">
          <li><strong>A coding agent.</strong> A molted.cloud agent, Claude Code, Codex or another one: the <code>@miakapp/cli</code> CLI and its guide are all it needs.</li>
          <li><strong>A machine that stays on at home</strong> for the coordinator: a Raspberry Pi or a mini PC.</li>
          <li><strong>A Miakapp account</strong>, to create the home and invite the people who live there.</li>
        </ul>
        <p>Miakapp’s code is public: <a href={SOURCE_URL} rel="noopener">github.com/Miakapp/Miakapp</a>.</p>
      </section>

      <section className="landing-closing content-closing">
        <div>
          <h2>So what do you ask it?</h2>
          <p>Requests no rule editor can write.</p>
        </div>
        <div className="content-closing__actions">
          <a className="product-button product-button--light" href={contentPage('ideas').path.en}>See the ideas <span aria-hidden="true">→</span></a>
          <a className="content-closing__link" href={APP_LINKS.newHome}>Create my home</a>
        </div>
      </section>
    </>
  );
}

export function HowItWorksPage({ locale }: ContentPageProps): React.JSX.Element {
  return (
    <ContentShell id="how-it-works" locale={locale}>
      {locale === 'fr' ? <French /> : <English />}
    </ContentShell>
  );
}
