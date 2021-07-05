<template>
  <div class="block">
    <div class="title">Account</div>

    <div class="gridForm">
      <!-- eslint-disable-next-line -->
      <svg viewBox="0 0 32 32"><circle cx="8" cy="11" r="4"/><path d="M10,16H6a5,5,0,0,0-5,5v4a1,1,0,0,0,1,1H14a1,1,0,0,0,1-1V21A5,5,0,0,0,10,16Z"/><path d="M30,15H18a1,1,0,0,1,0-2H30a1,1,0,0,1,0,2Z"/><path d="M30,19H18a1,1,0,0,1,0-2H30a1,1,0,0,1,0,2Z"/><path d="M24,23H18a1,1,0,0,1,0-2h6a1,1,0,0,1,0,2Z"/></svg>
      <input type="text" placeholder="Display name" autocomplete="name"
        v-model="aForm.displayName">
      <div class="button green" @click="saveDisplayName" :class="{
        disabled: !aForm.displayName || aForm.displayName === fUser.displayName
      }">Save</div>

      <!-- eslint-disable-next-line -->
      <svg class="sticked" viewBox="0 0 100 100"><g transform="translate(0,-952.36218)"><path d="m 16.999997,972.3622 c -4.934069,0 -8.9999995,4.0659 -8.9999995,9 l 0,42 c 0,4.9341 4.0659305,9 8.9999995,9 l 66.000001,0 c 4.934069,0 9.000004,-4.0659 9.000004,-9 l 0,-42 c 0,-4.9341 -4.065935,-9 -9.000004,-9 l -66.000001,0 z m 0.5,6 64.968751,0 -30.437501,28.0938 c -1.42593,1.3162 -2.70232,1.3154 -4.125,0 l -30.40625,-28.0938 z m -3.5,4.9062 29.8125,27.5938 c 3.440621,3.1813 8.87153,3.1764 12.3125,0 l 29.875001,-27.5938 0,40.0938 c 0,1.7139 -1.286151,3 -3,3 l -66.000001,0 c -1.71385,0 -3,-1.2861 -3,-3 l 0,-40.0938 z"/></g></svg>
      <input class="sticked" type="text" placeholder="Email" autocomplete="email"
        v-model="aForm.email">
      <div class="button green sticked" @click="saveEmail" :class="{
        disabled: !aForm.email || aForm.email === fUser.email
      }">Save</div>
      <div class="button fullGrid big sticked" v-if="!fUser.emailVerified && fUser.email"
        :class="{ disabled: validEmailSent }" @click="sendConfirmEmail">
        {{ validEmailSent ? 'Email sent ✓' : 'Send verification email'}}
      </div>

      <!-- eslint-disable-next-line -->
      <svg class="sticked" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
      <input class="sticked" type="text" placeholder="Phone number" autocomplete="tel"
        v-model="aForm.phoneNumber">
      <div class="button green sticked" @click="savePhone" :class="{
        disabled: !aForm.phoneNumber || aForm.phoneNumber === fUser.phoneNumber
      }">Save</div>
      <div class="fullGrid sticked" id="captcha" v-show="needCaptcha"/>

      <div class="button fullGrid big sticked" v-if="fUser.email"
        :class="{ disabled: resetEmailSent }" @click="sendResetPassword">
        {{ resetEmailSent ? 'Email sent ✓' : 'Reset password'}}
      </div>

      <div class="button wIcon fullGrid" @click="googleLink">
        <!-- eslint-disable-next-line -->
        <svg viewBox="0 0 118 120"><path d="M117.6,61.3636364 C117.6,57.1090909 117.218182,53.0181818 116.509091,49.0909091 L60,49.0909091 L60,72.3 L92.2909091,72.3 C90.9,79.8 86.6727273,86.1545455 80.3181818,90.4090909 L80.3181818,105.463636 L99.7090909,105.463636 C111.054545,95.0181818 117.6,79.6363636 117.6,61.3636364 L117.6,61.3636364 Z" fill="#4285F4"/><path d="M60,120 C76.2,120 89.7818182,114.627273 99.7090909,105.463636 L80.3181818,90.4090909 C74.9454545,94.0090909 68.0727273,96.1363636 60,96.1363636 C44.3727273,96.1363636 31.1454545,85.5818182 26.4272727,71.4 L6.38181818,71.4 L6.38181818,86.9454545 C16.2545455,106.554545 36.5454545,120 60,120 L60,120 Z" fill="#34A853"/><path d="M26.4272727,71.4 C25.2272727,67.8 24.5454545,63.9545455 24.5454545,60 C24.5454545,56.0454545 25.2272727,52.2 26.4272727,48.6 L26.4272727,33.0545455 L6.38181818,33.0545455 C2.31818182,41.1545455 0,50.3181818 0,60 C0,69.6818182 2.31818182,78.8454545 6.38181818,86.9454545 L26.4272727,71.4 L26.4272727,71.4 Z" fill="#FBBC05"/><path d="M60,23.8636364 C68.8090909,23.8636364 76.7181818,26.8909091 82.9363636,32.8363636 L100.145455,15.6272727 C89.7545455,5.94545455 76.1727273,0 60,0 C36.5454545,0 16.2545455,13.4454545 6.38181818,33.0545455 L26.4272727,48.6 C31.1454545,34.4181818 44.3727273,23.8636364 60,23.8636364 L60,23.8636364 Z" fill="#EA4335"/></svg>
        <div>{{ googleProvider ? 'Unlink from' : 'Link with' }} Google</div>
      </div>

      <div class="button wIcon fullGrid sticked" @click="githubLink">
        <!-- eslint-disable-next-line -->
        <svg viewBox="0 0 20 20"><path d="M10 0C4.476 0 0 4.477 0 10c0 4.418 2.865 8.166 6.84 9.49.5.09.68-.218.68-.483 0-.237-.007-.866-.012-1.7-2.782.603-3.37-1.34-3.37-1.34-.454-1.157-1.11-1.464-1.11-1.464-.907-.62.07-.608.07-.608 1.003.07 1.53 1.03 1.53 1.03.893 1.53 2.342 1.087 2.912.83.09-.645.35-1.085.634-1.335-2.22-.253-4.555-1.11-4.555-4.943 0-1.09.39-1.984 1.03-2.683-.105-.253-.448-1.27.096-2.647 0 0 .84-.268 2.75 1.026A9.555 9.555 0 0110 4.836a9.59 9.59 0 012.504.337c1.91-1.294 2.747-1.026 2.747-1.026.548 1.377.204 2.394.1 2.647.64.7 1.03 1.592 1.03 2.683 0 3.842-2.34 4.687-4.566 4.935.36.308.678.92.678 1.852 0 1.336-.01 2.415-.01 2.743 0 .267.18.578.687.48A10 10 0 0020 10c0-5.522-4.478-10-10-10"/></svg>
        <div>{{ githubProvider ? 'Unlink from' : 'Link with' }} GitHub</div>
      </div>
    </div>

    <div class="button bigRed" @click="disconnect">Disconnect</div>
  </div>
</template>

<script>
/** @type {import('firebase').default} */
const firebase = window.firebase;

/** @type {import('firebase').default.auth.Auth} */
const auth = window.auth;

/** @type {import('izitoast').IziToast} */
const toast = window.toast;
const toastErr = (err) => toast.error({ title: err.message });

export default {
  name: 'AccountSettings',

  props: {
    fUser: Object,
  },

  data: () => ({
    aForm: {
      email: '',
      displayName: '',
      phoneNumber: '',
    },

    googleProvider: false,
    githubProvider: false,

    validEmailSent: false,
    resetEmailSent: false,
    needCaptcha: false,
  }),

  mounted() {
    this.updateValues();
  },

  watch: {
    fUser() {
      this.updateValues();
    },
  },

  methods: {
    updateValues() {
      this.aForm.email = this.fUser.email;
      this.aForm.displayName = this.fUser.displayName;
      this.aForm.phoneNumber = this.fUser.phoneNumber;

      this.googleProvider = !!auth.currentUser.providerData.find((p) => p.providerId === 'google.com');
      this.githubProvider = !!auth.currentUser.providerData.find((p) => p.providerId === 'github.com');
    },

    saveDisplayName() {
      auth.currentUser.updateProfile({
        displayName: this.aForm.displayName,
      }).then(() => {
        auth.updateCurrentUser(auth.currentUser);
        toast.success({ title: 'Display name changed !' });
      }).catch(toastErr);
    },

    saveEmail() {
      auth.currentUser.updateEmail(this.aForm.email).then(() => {
        auth.updateCurrentUser(auth.currentUser);
        toast.success({ title: 'Email changed !' });
      }).catch(toastErr);
    },

    sendConfirmEmail() {
      auth.currentUser.sendEmailVerification().then(() => {
        this.validEmailSent = true;
        toast.success({ title: 'Verification email sent' });
      }).catch(toastErr);
    },

    sendResetPassword() {
      toast.confirm('We will send you an email to reset your password', () => {
        auth.sendPasswordResetEmail(auth.currentUser.email).then(() => {
          this.resetEmailSent = true;
          toast.success({ title: 'Password reset email sent' });
        }).catch(toastErr);
      });
    },

    googleLink() {
      const provider = new firebase.auth.GoogleAuthProvider();
      this.providerLinkChange(provider, 'Google', this.googleProvider);
    },

    githubLink() {
      const provider = new firebase.auth.GithubAuthProvider();
      this.providerLinkChange(provider, 'GitHub', this.githubProvider);
    },

    providerLinkChange(provider, name, unlink = true) {
      if (unlink) {
        toast.confirm(`Are you sure you want to unlink your ${name} account ?`, () => {
          auth.currentUser.unlink(provider.providerId).then(() => {
            auth.updateCurrentUser(auth.currentUser);
            toast.success({ title: `${name} account unlinked !` });
          }).catch(toastErr);
        });
      } else {
        auth.currentUser.linkWithPopup(provider).then(() => {
          auth.updateCurrentUser(auth.currentUser);
          toast.success({ title: `${name} account linked !` });
        }).catch(toastErr);
      }
    },

    disconnect() {
      localStorage.removeItem('data');
      auth.signOut().then(() => window.location.reload()).catch(toastErr);
    },

    savePhone() {
      this.needCaptcha = true;
      window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('captcha', {
        callback: () => {
          const method = `${(auth.currentUser.phoneNumber ? 'reauthenticate' : 'link')}WithPhoneNumber`;
          auth.currentUser[method](this.aForm.phoneNumber, window.recaptchaVerifier)
            .then((confirmationResult) => {
              this.needCaptcha = false;
              this.phoneConfirm = confirmationResult;
              toast.show({
                timeout: false,
                overlay: true,
                displayMode: 'once',
                id: 'phoneCode',
                zindex: 999,
                title: 'Enter phone code',
                position: 'center',
                drag: false,
                inputs: [
                  ['<input type="text" autocomplete="one-time-code">', 'keyup', (i, t, input, e) => {
                    if (input.value.length !== 6
                      || (e.keyCode !== 13 && (e.keyCode < 96 || e.keyCode > 105))
                    ) return;

                    if (auth.currentUser.phoneNumber) {
                      const credential = firebase.auth.PhoneAuthProvider.credential(
                        confirmationResult.verificationId, input.value,
                      );
                      auth.currentUser.updatePhoneNumber(credential).then(() => {
                        auth.updateCurrentUser(auth.currentUser);
                        toast.success({ title: 'Phone changed !' });
                        i.hide({ transitionOut: 'fadeOut' }, t, 'OK');
                      }).catch(toastErr);
                    } else {
                      confirmationResult.confirm(input.value).then(() => {
                        auth.updateCurrentUser(auth.currentUser);
                        toast.success({ title: 'Phone linked !' });
                        i.hide({ transitionOut: 'fadeOut' }, t, 'OK');
                      }).catch(toastErr);
                    }
                  }, true],
                ],
              });
            }).catch((err) => {
              this.needCaptcha = false;
              toastErr(err);
            });
        },
        'expired-callback': () => {
          this.needCaptcha = false;
          toast.error({ title: 'Captcha expired, please retry' });
        },
      });

      window.recaptchaVerifier.render();
    },
  },
};
</script>

<style scoped>
.gridForm {
  display: grid;
  grid-template-columns: min-content auto min-content;
  max-width: 350px;
  margin: 0 auto;
}

.gridForm > svg {
  width: 50px;
  height: calc(100% - 10px);
  margin: 5px 0;
  fill: var(--color1);
  background-color: var(--color4-s);
  padding: 0 13px;
}

.fullGrid {
  grid-column: 1 / 4;
}

.big {
  grid-column: 1 / 4;
  grid-template-columns: auto;
  background-color: var(--color7);
  color: var(--color3);
}

.sticked { margin-top: 0 !important }
svg.sticked { height: calc(100% - 5px) }

@media screen and (max-width: 370px) {
  .gridForm > svg {
    width: 0;
    padding: 0;
  }
}
</style>
