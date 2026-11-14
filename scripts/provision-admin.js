const fs = require('fs');
const path = require('path');
const readline = require('readline');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

const EXPECTED_PROJECT_ID = 'paperplazo';

function logStage(stage, details = '') {
  const suffix = details ? ` - ${details}` : '';
  console.log(`[provision-admin] ${stage}${suffix}`);
}

function printUsage() {
  console.log('Usage: node scripts/provision-admin.js [<firebase-auth-uid>] [--verify]');
  console.log('');
  console.log('Required credentials:');
  console.log('  - Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path, or');
  console.log('  - Set FIREBASE_SERVICE_ACCOUNT to a path to a service-account JSON file, or');
  console.log('  - Authenticate via gcloud application-default login for ADC.');
  console.log('');
  console.log('Example:');
  console.log('  $ set GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\service-account.json');
  console.log('  $ node scripts/provision-admin.js ABC123xyz --verify');
}

function promptForUid() {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Enter the existing Firebase Authentication UID for the admin account: ', (answer) => {
      const uid = String(answer || '').trim();
      rl.close();
      if (!uid) {
        reject(new Error('No Firebase Authentication UID was entered.'));
        return;
      }
      resolve(uid);
    });
  });
}

function resolveServiceAccountPath() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountPath) {
    return null;
  }

  const resolvedPath = path.resolve(serviceAccountPath);
  logStage('Service account path resolved', resolvedPath);
  return resolvedPath;
}

function initAdminSdk() {
  const serviceAccountPath = resolveServiceAccountPath();

  if (serviceAccountPath) {
    let raw;
    try {
      raw = fs.readFileSync(serviceAccountPath, 'utf8');
    } catch (error) {
      throw new Error(`Unable to read Firebase service account file at: ${serviceAccountPath}. ${error.message}`);
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Firebase service account file is not valid JSON: ${serviceAccountPath}. ${error.message}`);
    }

    if (!serviceAccount.project_id) {
      throw new Error('Firebase service account JSON is missing the project_id field.');
    }

    if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
      throw new Error(
        `Firebase service account project_id mismatch. Expected "${EXPECTED_PROJECT_ID}" but found "${serviceAccount.project_id}".`
      );
    }

    logStage('Initializing Firebase Admin SDK with service account', `project_id=${serviceAccount.project_id}`);
    const apps = admin.apps || [];
    if (apps.length === 0) {
      admin.initializeApp({
        credential: admin.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
    }
    logStage('Firebase Admin SDK initialized successfully', `project_id=${serviceAccount.project_id}`);
    return { mode: 'service-account', projectId: serviceAccount.project_id };
  }

  logStage('No service account path found; attempting Application Default Credentials');
  const apps = admin.apps || [];
  if (apps.length === 0) {
    admin.initializeApp({
      credential: admin.applicationDefault()
    });
  }
  logStage('Firebase Admin SDK initialized successfully', 'using ADC');
  return { mode: 'adc', projectId: EXPECTED_PROJECT_ID };
}

async function verifyCustomClaim(uid) {
  logStage('Fetching Firebase user record', `uid=${uid}`);
  const user = await getAuth().getUser(uid);
  const hasAdminClaim = user.customClaims?.admin === true;

  console.log(`[provision-admin] UID: ${uid}`);
  console.log(`[provision-admin] customClaims.admin: ${hasAdminClaim}`);
  if (hasAdminClaim) {
    console.log('[provision-admin] Admin access is active.');
  } else {
    console.log('[provision-admin] Admin access is not active yet.');
  }

  return { user, hasAdminClaim };
}

async function provisionCustomClaim(uid) {
  logStage('Fetching current Firebase user record', `uid=${uid}`);
  const user = await getAuth().getUser(uid);
  const existingClaims = user.customClaims || {};
  const hasAdminClaim = existingClaims.admin === true;

  if (hasAdminClaim) {
    console.log(`[provision-admin] UID ${uid} already has admin custom claim.`);
    return { user, hasAdminClaim: true };
  }

  const mergedClaims = { ...existingClaims, admin: true };
  logStage('Updating custom claims', `uid=${uid} preserving existing claims: ${Object.keys(existingClaims).join(', ') || 'none'}`);
  await getAuth().setCustomUserClaims(uid, mergedClaims);
  console.log(`[provision-admin] Admin custom claim assigned to UID: ${uid}`);

  const refreshedUser = await getAuth().getUser(uid);
  const refreshedAdminClaim = refreshedUser.customClaims?.admin === true;
  console.log(`[provision-admin] Verified admin claim after update: ${refreshedAdminClaim}`);
  console.log('[provision-admin] Important: sign the admin user out and then sign them back in to refresh the ID token with the new custom claims.');
  return { user: refreshedUser, hasAdminClaim: refreshedAdminClaim };
}

async function main() {
  const args = process.argv.slice(2);
  console.log(`[provision-admin] argv: ${args.join(' ')}`);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return 1;
  }

  const verifyOnly = args.includes('--verify');
  const uidArg = args.find((arg) => !arg.startsWith('--'));

  logStage('Argument parse complete', `verifyOnly=${verifyOnly}, uidArg=${uidArg || 'not provided'}`);

  let uid = uidArg;
  if (!uid) {
    try {
      uid = await promptForUid();
    } catch (error) {
      console.error(`[provision-admin] ${error.message}`);
      return 1;
    }
  }

  logStage('UID selected', `uid=${uid}`);

  try {
    initAdminSdk();

    if (verifyOnly) {
      await verifyCustomClaim(uid);
      return 0;
    }

    await provisionCustomClaim(uid);
    return 0;
  } catch (error) {
    console.error('[provision-admin] Failed to complete admin claim operation.');
    console.error(`[provision-admin] Error: ${error && error.message ? error.message : String(error)}`);
    return 1;
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error('[provision-admin] Unhandled error.');
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
