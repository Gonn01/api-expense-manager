import { FirebaseIdentity } from "../utils/firebase-identity.js";

let identity = null;

export function makeFirebaseIdentity() {
    identity ??= new FirebaseIdentity();
    return identity;
}
