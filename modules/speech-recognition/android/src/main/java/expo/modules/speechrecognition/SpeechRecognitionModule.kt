package expo.modules.speechrecognition

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

class SpeechRecognitionModule : Module() {
    private var speechRecognizer: SpeechRecognizer? = null
    private var currentPromise: expo.modules.kotlin.Promise? = null
    private val TAG = "SpeechRecognition"

    override fun definition() = ModuleDefinition {
        Name("SpeechRecognition")

        Constants(
            mapOf(
                "ERROR_NETWORK" to SpeechRecognizer.ERROR_NETWORK,
                "ERROR_AUDIO" to SpeechRecognizer.ERROR_AUDIO,
                "ERROR_SERVER" to SpeechRecognizer.ERROR_SERVER,
                "ERROR_CLIENT" to SpeechRecognizer.ERROR_CLIENT,
                "ERROR_SPEECH_TIMEOUT" to SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                "ERROR_NO_MATCH" to SpeechRecognizer.ERROR_NO_MATCH,
                "ERROR_RECOGNIZER_BUSY" to SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
                "ERROR_INSUFFICIENT_PERMISSIONS" to SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS,
            )
        )

        AsyncFunction("isAvailable") { promise ->
            val available = SpeechRecognizer.isRecognitionAvailable(context)
            promise.resolve(available)
        }

        AsyncFunction("startListening") { language: String?, maxResults: Int, partialResults: Boolean, prompt: String? ->
            if (speechRecognizer != null) {
                promise.reject("ALREADY_LISTENING", "Speech recognition already in progress")
                return@AsyncFunction
            }

            if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                promise.reject("PERMISSION_DENIED", "Microphone permission not granted")
                return@AsyncFunction
            }

            val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
            speechRecognizer = recognizer

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, maxResults)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults)
                language?.let { putExtra(RecognizerIntent.EXTRA_LANGUAGE, it) }
                prompt?.let { putExtra(RecognizerIntent.EXTRA_PROMPT, it) }
            }

            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    Log.d(TAG, "onReadyForSpeech")
                }

                override fun onBeginningOfSpeech() {
                    Log.d(TAG, "onBeginningOfSpeech")
                }

                override fun onRmsChanged(rmsdB: Float) {}

                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {
                    Log.d(TAG, "onEndOfSpeech")
                }

                override fun onError(error: Int) {
                    Log.e(TAG, "Speech recognition error: $error")
                    val errorMessage = when (error) {
                        SpeechRecognizer.ERROR_NETWORK -> "Network error"
                        SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                        SpeechRecognizer.ERROR_SERVER -> "Server error"
                        SpeechRecognizer.ERROR_CLIENT -> "Client error"
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech timeout"
                        SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected"
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
                        else -> "Unknown error ($error)"
                    }
                    promise?.reject("RECOGNITION_ERROR", errorMessage)
                    cleanup()
                }

                override fun onResults(results: Bundle) {
                    val matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (matches != null && matches.isNotEmpty()) {
                        val jsonArray = JSONArray()
                        matches.forEach { jsonArray.put(it) }
                        promise?.resolve(jsonArray.toString())
                    } else {
                        promise?.reject("NO_RESULTS", "No recognition results")
                    }
                    cleanup()
                }

                override fun onPartialResults(partialResults: Bundle) {
                    val matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (matches != null && matches.isNotEmpty()) {
                        val jsonArray = JSONArray()
                        matches.forEach { jsonArray.put(it) }
                        promise?.resolve(jsonArray.toString())
                    }
                }

                override fun onEvent(eventType: Int, params: Bundle?) {}
            })

            recognizer.startListening(intent)
        }

        AsyncFunction("stopListening") {
            speechRecognizer?.stopListening()
            cleanup()
        }

        AsyncFunction("cancelListening") {
            speechRecognizer?.cancel()
            cleanup()
        }

        AsyncFunction("hasPermission") {
            val hasPermission = context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            promise.resolve(hasPermission)
        }

        AsyncFunction("requestPermission") {
            // Permission request should be handled by the app via Permissions API
            promise.resolve(false)
        }
    }

    private fun cleanup() {
        speechRecognizer?.destroy()
        speechRecognizer = null
        currentPromise = null
    }

    companion object {
        private const val TAG = "SpeechRecognition"
    }
}