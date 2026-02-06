<template lang="pug">
.loading(v-if="isLoading") Loading...
.error(v-if="isError")
  | {{ errorMessage }}
MicPermission(v-else-if="!isMicAccessGranted && !isError" :accessDenied="accessDenied")
.call(v-else-if="isMicAccessGranted && !isError")
  .settings-panel
    .vector
    Button(size="s" mode="primary" width="fill-container" icon="ic20-settings" @click="showSettings=true") Settings
  .call-state
    Timer(:callState="callState" v-if="callState===CallState.CONNECTED")
    Settings(v-if="showSettings" @update:closeSettings="showSettings=false" :call="call")
    Connection(v-if="callState===CallState.CONNECTING" @update:cancelBtn="disconnect")
    RedialCall(v-if="callState===CallState.DISCONNECTED && !callEnded" @update:callBtn="createCall")
    .controls(v-if="callState===CallState.CONNECTED")
      Hint(:text="micHint")
        Microphone(:call="call" @update:isMuted="changeMicHint")
      Hint(text="End the call")
        Decline(@click="disconnect")
      Hint(text="Indicator connection")
        ConnectionRate(:call="call")
  .vector-horizontal
</template>

<script lang="ts">
  import { defineComponent, ref, onMounted, watch } from 'vue';
  import { useRoute } from 'vue-router';
  import Connection from '@/components/Connection.vue';
  import { Button, Hint } from '@voximplant/spaceui';
  import * as VoxImplant from 'voximplant-websdk';
  import { Call } from 'voximplant-websdk/Call/Call';
  import { CallState } from '@/enums/CallState';
  import RedialCall from '@/components/RedialCall.vue';
  import MicPermission from '@/components/MicPermission.vue';
  import Settings from '@/components/Settings.vue';
  import Timer from '@/components/Timer.vue';
  import ConnectionRate from '@/components/ConnectionRate.vue';
  import Microphone from '@/components/Microphone.vue';
  import Decline from '@/components/Decline.vue';
  import { config } from '@/shared/config';

  type AgentSdkParams = {
    user: string;
    password: string;
    phone: string;
  };

  const agentSdkParamsMap: Record<string, AgentSdkParams> = {};

  const loadAgentConnections = async () => {
    if (!config.connectionsEndpoint || !config.connectionsPassword) {
      throw new Error('Connections configuration is not provided');
    }

    const response = await fetch(config.connectionsEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password: config.connectionsPassword,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to load agent connections: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    Object.keys(data).forEach((agentId) => {
      const params = data[agentId];
      if (params && params.user && params.password && params.phone) {
        agentSdkParamsMap[agentId] = {
          user: params.user,
          password: params.password,
          phone: params.phone,
        };
      }
    });
  };

  const resolveAgentIdByCallId = async (callId: string): Promise<string> => {
    if (!config.agentResolveEndpoint) {
      throw new Error('Agent resolve endpoint is not configured');
    }

    const response = await fetch(config.agentResolveEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        call_id: callId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to resolve agent_id: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.agent_id) {
      throw new Error('agent_id is missing in response');
    }

    return data.agent_id as string;
  };

  export default defineComponent({
    components: {
      Decline,
      Microphone,
      ConnectionRate,
      Timer,
      Settings,
      MicPermission,
      RedialCall,
      Connection,
      Button,
      Hint,
    },
    setup() {
      const route = useRoute();
      const callState = ref<string>('');
      const accessDenied = ref<boolean>(false);
      const isMicAccessGranted = ref<boolean>(false);
      const isLoading = ref<boolean>(true);
      const isError = ref<boolean>(false);
      const errorMessage = ref<string>('');
      const sdk = VoxImplant.getInstance();

      const callEnded = ref<boolean>(false);
      const currentAgentId = ref<string | null>(null);

      const checkCallLock = async () => {
        const callId = route.params.callId as string;

        if (!callId) {
          isError.value = true;
          errorMessage.value = 'No callId provided in URL path';
          isLoading.value = false;
          return;
        }

        try {
          const agentId = await resolveAgentIdByCallId(callId);
          currentAgentId.value = agentId;

          const agentParams = agentSdkParamsMap[agentId];
          if (!agentParams) {
            throw new Error('No SDK params found for resolved agent_id');
          }

          const response = await fetch(config.lockEndpoint as string, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              call_id: callId,
              phone_number: agentParams.phone,
            }),
          });

          if (response.status !== 200) {
            const errorText = await response.text();
            isError.value = true;
            errorMessage.value = `${errorText.substring(0, 100)}`;
          }
        } catch (error: any) {
          isError.value = true;
          errorMessage.value = `Network error: ${error.message}`;
        } finally {
          isLoading.value = false;
        }
      };

      sdk.on(VoxImplant.Events.MicAccessResult, (e) => {
        if (e.result === true) {
          isMicAccessGranted.value = true;
        } else {
          accessDenied.value = true;
        }
      });

      const call = ref<Call | null>(null);

      const initSdk = () => {
        const agentId = currentAgentId.value;
        if (!agentId) {
          isError.value = true;
          errorMessage.value = 'Agent id is not resolved';
          return;
        }

        const agentParams = agentSdkParamsMap[agentId];
        if (!agentParams) {
          isError.value = true;
          errorMessage.value = 'SDK params for current agent are not available';
          return;
        }

        sdk
          .init({
            micRequired: true,
            showDebugInfo: true,
            progressTone: true,
            progressToneCountry: 'US',
            node: config.accountNode,
          })
          .then(() => sdk.connect())
          .then(() => sdk.login(agentParams.user, agentParams.password))
          .then(() => {
            createCall();
          });
      };

      const disconnect = () => {
        call.value?.hangup();
      };

      const createCall = () => {
        if (callEnded.value) return;

        const agentId = currentAgentId.value;
        if (!agentId) {
          isError.value = true;
          errorMessage.value = 'Agent id is not resolved';
          return;
        }

        call.value = sdk.call({
          number: config.number,
          video: { sendVideo: false, receiveVideo: false },
        });
        callState.value = CallState.CONNECTING;
        call.value.on(VoxImplant.CallEvents.Connected, () => {
          callState.value = CallState.CONNECTED;
        });
        call.value.on(VoxImplant.CallEvents.Disconnected, () => {
          callState.value = CallState.DISCONNECTED;
        });
        call.value.on(VoxImplant.CallEvents.Failed, () => {
          callState.value = CallState.DISCONNECTED;
        });
      };

      watch(callState, (newState) => {
        if (newState === CallState.DISCONNECTED && !callEnded.value) {
          callEnded.value = true;
        }
      });

      const showSettings = ref<boolean>(false);
      const sendDigit = (digit: string) => {
        call.value?.sendTone(digit);
      };
      const micHint = ref<string>('Mute');
      const changeMicHint = (value: string) => {
        micHint.value = value;
      };

      onMounted(async () => {
        try {
          await loadAgentConnections();
        } catch (error: any) {
          isError.value = true;
          errorMessage.value = error.message || 'Failed to load agent connections';
          isLoading.value = false;
          return;
        }

        await checkCallLock();
        if (!isError.value) {
          initSdk();
        }
      });

      return {
        callState,
        CallState,
        createCall,
        disconnect,
        isMicAccessGranted,
        accessDenied,
        showSettings,
        sendDigit,
        sdk,
        call,
        changeMicHint,
        micHint,
        isLoading,
        isError,
        errorMessage,
        callEnded,
      };
    },
  });
</script>

<style scoped>
  .call {
    position: absolute;
    margin: 0;
    top: 50%;
    left: 50%;
    -ms-transform: translate(-50%, -50%);
    transform: translate(-50%, -50%);
    width: 350px;
    height: 500px;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #ffffff;
    box-shadow: 0 2px 8px rgba(40, 41, 61, 0.04), 0 16px 24px rgba(96, 97, 112, 0.16);
    border-radius: 12px;
  }

  .settings-panel {
    display: flex;
    justify-content: space-around;
    position: relative;
    width: 350px;
    border-radius: 8px 8px 0 0;
    overflow: hidden;
    & >>> .sui-button {
      height: 64px;
      border-radius: 0;
    }
    & >>> .sui-icon {
      --sui-icon-color: #ffffff !important;
    }
  }

  .vector {
    position: absolute;
    width: 0;
    height: 64px;
    left: 175px;
    top: 0;
    border-right: 1px solid #8b55ff;
  }

  .call-state {
    position: relative;
    box-sizing: border-box;
    padding: 32px 0;
    height: 388px;
    width: 100%;
    display: flex;
    align-items: center;
    flex-direction: column;
  }

  .controls {
    position: relative;
    height: 44px;
    width: 188px;
    margin-top: 24px;
    box-sizing: border-box;
    display: flex;
    justify-content: space-between;
    & .hint-container {
      width: 44px;
    }
    & >>> .sui-tooltip {
      padding: 2px 0;
      width: max-content;
      width: -moz-max-content;
      white-space: nowrap;
      min-width: 40px;
      min-height: 20px;
    }
    & >>> .sui-tooltip-message {
      border-left: solid 6px transparent;
      border-right: solid 6px transparent;
    }
  }

  .vector-horizontal {
    position: relative;
    width: 318px;
    height: 0;
    border-top: 1px solid #ebedf2;
  }

  .loading, .error {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    font-size: 16px;
    color: #666;
    flex-direction: column;
    padding: 20px;
    text-align: center;
    white-space: pre-wrap;
  }

  .error {
    color: #d32f2f;
    max-width: 400px;
  }
</style>
