-- Executes a generated JSX file inside Adobe Photoshop through AppleScript.
-- Called only by the Node bridge (src/photoshop/bridge/applescript-adapter.ts).
-- argv: scriptPath, resultPath, noLaunch ("true"|"false")
on run argv
	set scriptPath to item 1 of argv
	set resultPath to item 2 of argv
	set noLaunch to item 3 of argv

	try
		tell application "System Events"
			set isRunning to (exists (first process whose name starts with "Adobe Photoshop"))
		end tell

		if noLaunch is "true" and not isRunning then
			my writeEnvelope(resultPath, "PHOTOSHOP_NOT_RUNNING", "Photoshop is not running and auto-launch is disabled (PHOTOSHOP_AUTO_LAUNCH=false).")
			return
		end if

		set jsxFile to POSIX file scriptPath
		tell application id "com.adobe.Photoshop"
			if noLaunch is not "true" then activate
			-- Equivalent to Windows DoJavaScriptFile; never opens the ExtendScript debugger.
			do javascript file jsxFile show debugger never
		end tell

		try
			do shell script "test -f " & quoted form of resultPath
		on error
			my writeEnvelope(resultPath, "PHOTOSHOP_SCRIPT_ERROR", "Photoshop returned no result. The script may have failed to parse.")
		end try
	on error errMsg number errNum
		if errNum is -1728 or errNum is -10814 or errNum is -600 then
			my writeEnvelope(resultPath, "PHOTOSHOP_NOT_INSTALLED", "Could not target Adobe Photoshop via AppleScript: " & errMsg)
		else
			my writeEnvelope(resultPath, "BRIDGE_UNAVAILABLE", errMsg)
		end if
	end try
end run

on writeEnvelope(resultPath, code, message)
	set escaped to my escapeJson(message)
	set payload to "{\"ok\":false,\"error\":{\"code\":\"" & code & "\",\"message\":\"" & escaped & "\"}}"
	do shell script "printf %s " & quoted form of payload & " > " & quoted form of resultPath
end writeEnvelope

on escapeJson(s)
	set s to my replaceText(s, "\\", "\\\\")
	set s to my replaceText(s, "\"", "\\\"")
	set s to my replaceText(s, return, " ")
	set s to my replaceText(s, linefeed, " ")
	return s
end escapeJson

on replaceText(theText, searchString, replacement)
	set AppleScript's text item delimiters to searchString
	set theItems to text items of theText
	set AppleScript's text item delimiters to replacement
	set theText to theItems as text
	set AppleScript's text item delimiters to ""
	return theText
end replaceText
