# Configurer le stockage cloud GAMEFORGE

GAMEFORGE utilise Supabase Auth pour les comptes et PostgreSQL avec Row Level Security (RLS) pour isoler les espaces privés et partager les projets. La clé `anon`/publishable est destinée au navigateur ; ne placez jamais une clé `service_role` dans l’application.

## 1. Créer le projet Supabase

1. Créez un projet Supabase et conservez son URL et sa clé publishable (ou sa clé `anon`).
2. Dans **SQL Editor**, exécutez le script [`supabase/migrations/202611100001_gameforge_accounts_and_collaboration.sql`](./supabase/migrations/202611100001_gameforge_accounts_and_collaboration.sql).
3. Exécutez ensuite [`supabase/migrations/202611110001_gameforge_project_resources_and_milestone_dates.sql`](./supabase/migrations/202611110001_gameforge_project_resources_and_milestone_dates.sql) pour activer les ressources liées, la discussion de projet et les dates cibles des jalons. Si la migration de base a déjà été exécutée, n’exécutez que cette seconde migration.
4. Exécutez [`supabase/migrations/202611120001_gameforge_project_chat_actions.sql`](./supabase/migrations/202611120001_gameforge_project_chat_actions.sql) pour activer les réponses, réactions, épingles et suppressions de messages. Si les deux premières migrations sont déjà appliquées, exécutez uniquement cette nouvelle migration.
5. Exécutez [`supabase/migrations/202611130001_gameforge_theme_and_project_logos.sql`](./supabase/migrations/202611130001_gameforge_theme_and_project_logos.sql) pour activer les logos de projet. La migration ajoute la colonne `logo_url`, crée le bucket public `gameforge-project-logos` et limite l’envoi et la suppression au propriétaire du projet. Si les migrations précédentes sont déjà appliquées, exécutez uniquement cette migration.
6. Exécutez [`supabase/migrations/202611140001_fix_project_logo_storage_rls.sql`](./supabase/migrations/202611140001_fix_project_logo_storage_rls.sql) pour fiabiliser les règles RLS d’envoi et de suppression des logos. Si la migration des logos a déjà été exécutée et que l’envoi renvoie une erreur RLS, exécutez uniquement cette migration corrective.
7. Dans **Authentication → Providers → Email**, activez l’authentification par e-mail et désactivez **Confirm email**. La création de compte donnera alors directement une session sans envoyer de message de confirmation. L’adresse e-mail reste l’identifiant du compte, mais elle ne sera pas vérifiée.
8. Dans **Authentication → URL Configuration**, définissez l’URL locale `http://localhost:5173` et ajoutez-la aux redirect URLs autorisées. Ajoutez aussi l’URL de votre déploiement avant de publier.
9. Exécutez [`supabase/migrations/202611150001_gameforge_project_roles_and_deadlines.sql`](./supabase/migrations/202611150001_gameforge_project_roles_and_deadlines.sql) pour activer les rôles d’équipe et de tâches, les copropriétaires, ainsi que les échéances sur toutes les tâches. Cette migration attribue le rôle **Owner** aux tâches déjà présentes. Si les migrations précédentes sont déjà appliquées, exécutez uniquement cette nouvelle migration.
10. Exécutez [`supabase/migrations/202611160001_gameforge_private_usage_analytics.sql`](./supabase/migrations/202611160001_gameforge_private_usage_analytics.sql) pour ajouter les statistiques agrégées privées d’utilisation. Si les migrations précédentes sont déjà appliquées, exécutez uniquement celle-ci.

Après la migration, configurez l’unique administrateur du tableau depuis le **SQL Editor** Supabase :

1. Dans **Authentication → Users**, copiez l’UUID du compte GAMEFORGE qui doit être le seul à voir les statistiques.
2. Exécutez cette requête en remplaçant le texte entre apostrophes par cet UUID :

```sql
update public.gameforge_usage_config
set owner_id = 'REMPLACER-PAR-L-UUID-DU-COMPTE'::uuid
where singleton = true;
```

Cette configuration ne donne pas accès aux données des autres comptes. La base conserve seulement le nombre total de comptes créés, le nombre de visites connectées (au plus une par compte toutes les 30 minutes), ainsi que l’identifiant interne et la dernière activité nécessaires au calcul des utilisateurs actifs. Les identifiants ne sont pas accessibles depuis le navigateur et l’API du tableau ne retourne que les compteurs agrégés. Les visites des personnes non connectées ne sont pas comptabilisées. Le nombre de comptes existants est initialisé au moment où la migration est exécutée.

Si vous réinitialisez une configuration GAMEFORGE déjà créée, exécutez d’abord [`supabase/reset_gameforge.sql`](./supabase/reset_gameforge.sql), puis relancez les migrations dans l’ordre. La réinitialisation supprime les données GAMEFORGE cloud, mais conserve les comptes Supabase Auth et les autres objets de la base.

## 2. Connecter l’application

Dans le dossier du projet, copiez `.env.example` vers `.env.local` et renseignez les valeurs fournies par Supabase :

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Ne partagez pas `.env.local` et ne le commitez pas. Le fichier est ignoré par Git. Redémarrez ensuite le serveur Vite :

```powershell
npm run dev
```

## Comptes, stockage et projets partagés

- Chaque personne crée son compte avec son adresse e-mail et son mot de passe. Avec **Confirm email** désactivé, elle peut utiliser GAMEFORGE immédiatement, sans e-mail de confirmation.
- Le changement de mot de passe se fait depuis **Paramètres → Compte et mot de passe** pendant que la personne est connectée ; l’ancien mot de passe est demandé et aucun e-mail n’est envoyé. La récupération en cas de mot de passe oublié n’est pas disponible dans l’application afin d’éviter les e-mails de réinitialisation. Gardez donc votre mot de passe en lieu sûr.
- Lors de la première connexion d’un compte sans espace cloud, les données GAMEFORGE locales présentes dans ce navigateur sont importées vers ce compte. Après une migration réussie, l’ancienne copie locale partagée est effacée. Les données suivantes sont enregistrées dans le cloud.
- Les scripts, assets, collections et préférences sont privés au compte. Les projets et leur tableau de tâches sont partagés avec les collaborateurs du projet.
- À la création d’un projet, un modèle (Obby, simulation, jeu à manches, RPG ou Tycoon) peut préremplir le tableau de tâches ; le projet vierge reste disponible. L’export du projet produit une archive ZIP avec le tableau, les scripts et ressources liés, et les IDs Roblox des assets. Les notes privées de la bibliothèque ne sont pas incluses.
- L’historique conserve jusqu’à 20 versions précédentes par script ; il est privé au compte et inclus dans la sauvegarde de l’espace. Des liens vers les références officielles Roblox sont disponibles dans les modèles de scripts et le générateur.
- Dans **Conception du jeu**, le propriétaire choisit **Inviter des collaborateurs** puis génère un lien. Toute personne qui l’ouvre doit se connecter ou créer un compte ; elle rejoint alors le projet avec le rôle d’éditeur. Le lien expire après 7 jours. En générer un autre révoque le précédent ; le bouton de révocation invalide le lien actif.
- Le propriétaire et les copropriétaires peuvent gérer l’équipe et attribuer plusieurs rôles à chaque collaborateur. Les copropriétaires ont les mêmes permissions que le propriétaire. Une nouvelle personne rejoint sans rôle métier attribué ; l’équipe peut ensuite lui en attribuer dans **Gérer l’équipe**.
- Les tâches doivent avoir au moins un rôle associé. Chaque personne voit d’abord les tâches correspondant à un ou plusieurs de ses rôles ; **Voir toutes les tâches** désactive ce filtre. Les dates facultatives apparaissent dans la liste chronologique des échéances sous le kanban.
- Les scripts et assets peuvent être liés à un projet. Les scripts sont copiés sous forme de snapshot consultable par les collaborateurs ; les assets partagent leur ID Roblox et leur description, sans partager les notes privées. Les modifications ultérieures dans la bibliothèque personnelle ne changent pas le snapshot lié.
- Les tâches du tableau peuvent avoir une date cible facultative, visible par les collaborateurs et signalée comme en retard si elle est dépassée.
- Chaque projet dispose d’une discussion en direct. Les noms et rôles de l’équipe apparaissent à côté des messages. Les membres peuvent joindre une ressource déjà liée, répondre aux messages, réagir avec des emojis et épingler/désépingler les messages. Chaque membre peut supprimer ses propres messages ; le propriétaire et les copropriétaires peuvent supprimer n’importe quel message. Les 100 messages les plus récents sont chargés.
- Les changements des projets, tableaux, ressources liées, messages et réactions sont actualisés entre les sessions ouvertes avec Supabase Realtime.
- Le propriétaire ou un copropriétaire peut ajouter ou retirer le logo d’un projet depuis **Conception du jeu → Modifier les détails**. Les images sont redimensionnées et converties en WebP avant l’envoi ; le bucket est public pour que les collaborateurs puissent voir le logo.
- Après configuration de son UUID dans `gameforge_usage_config`, le compte administrateur voit **Statistiques d’utilisation** dans la barre latérale. Ce tableau privé affiche les visites connectées, les comptes créés, les utilisateurs actifs sur 7 et 30 jours et la dernière activité globale. Aucun e-mail, adresse IP, contenu de projet, script ou message n’est collecté par cette fonctionnalité.
- Les règles RLS et les fonctions SQL limitent les données consultables et modifiables au propriétaire du compte ou aux membres du projet. Les liens ne contiennent qu’un jeton aléatoire dont seule l’empreinte est conservée en base.

Les données cloud dépendent de la disponibilité et de la configuration de votre projet Supabase. Gardez une sauvegarde JSON depuis **Paramètres → Sauvegarde et restauration**.

## Publier le site avec GitHub Pages

Le workflow [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) compile puis publie GAMEFORGE sur GitHub Pages à chaque push sur la branche `main` (ou manuellement depuis **Actions**). Le dépôt doit être sur GitHub et la fonctionnalité **Pages** doit utiliser **GitHub Actions** comme source.

1. Créez un dépôt GitHub. Si vous voulez que le site soit accessible publiquement sans restriction, choisissez un dépôt public.
2. Dans **Settings → Secrets and variables → Actions**, ajoutez ces *repository secrets* depuis les valeurs de votre projet Supabase :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (clé `anon`/publishable uniquement, jamais la clé `service_role`)
3. Envoyez le projet sur la branche `main`. Dans **Settings → Pages**, sélectionnez **GitHub Actions**. Le workflow calcule automatiquement le chemin de base pour un site de projet, par exemple `https://UTILISATEUR.github.io/NOM-DU-DEPOT/`.
4. Dans Supabase, ouvrez **Authentication → URL Configuration** et ajoutez l’URL complète du site GitHub Pages aux redirect URLs autorisées. Gardez également l’URL locale autorisée pour le développement.
5. Vérifiez que toutes les migrations, y compris les migrations GAMEFORGE les plus récentes, ont été exécutées dans la base Supabase. Le workflow ne modifie pas la base de données.

La clé publishable/`anon` est utilisée côté navigateur par nature ; la sécurité des données repose sur les politiques RLS Supabase. Les secrets GitHub évitent de mettre la configuration dans le dépôt, mais les valeurs `VITE_*` sont intégrées au JavaScript construit et ne doivent donc jamais être des clés privilégiées.
