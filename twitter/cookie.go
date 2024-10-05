package twitter

import (
	"encoding/json"
	"net/http"
	"reflect"
	"time"
	"unicode"
)

// Convert http.Cookie to a map for JSON serialization
func CookieToMap(cookie *http.Cookie) (map[string]any, error) {
	result := make(map[string]any)
	val := reflect.ValueOf(cookie).Elem()
	typ := val.Type()

	for i := 0; i < val.NumField(); i++ {
		field := typ.Field(i)
		if field.PkgPath != "" { // Skip unexported fields
			continue
		}

		// camelCase
		name := string(unicode.ToLower(rune(field.Name[0]))) + field.Name[1:]

		result[name] = val.Field(i).Interface()
	}
	return result, nil
}

// MapToCookie populates an http.Cookie struct from a map
func MapToCookie(data map[string]any) (*http.Cookie, error) {
	cookie := &http.Cookie{}
	val := reflect.ValueOf(cookie).Elem()

	for key, value := range data {
		if len(key) == 0 {
			continue
		}

		// CamelCase
		key := string(unicode.ToUpper(rune(key[0]))) + key[1:]

		field := val.FieldByName(key)
		if !field.IsValid() || !field.CanSet() {
			continue
		}

		// Type assertion based on the expected types of http.Cookie fields
		switch field.Kind() {
		case reflect.String:
			if v, ok := value.(string); ok {
				field.SetString(v)
			}
		case reflect.Int:
			if v, ok := value.(float64); ok { // JSON numbers are float64 by default
				field.SetInt(int64(v))
			}
		case reflect.Bool:
			if v, ok := value.(bool); ok {
				field.SetBool(v)
			}
		case reflect.Struct:
			if v, ok := value.(string); ok && field.Type() == reflect.TypeOf(time.Time{}) {
				parsedTime, err := time.Parse(time.RFC3339, v)
				if err == nil {
					field.Set(reflect.ValueOf(parsedTime))
				}
			}
		}
	}

	return cookie, nil
}

func marshalCookies(cookies []*http.Cookie) string {
	result := make([]map[string]any, len(cookies))
	for i, cookie := range cookies {
		cookieMap, _ := CookieToMap(cookie)
		result[i] = cookieMap
	}

	b, _ := json.Marshal(result)
	return string(b)
}

func unmarshalCookies(data string) []*http.Cookie {
	var result []map[string]any
	if err := json.Unmarshal([]byte(data), &result); err != nil {
		return nil
	}

	cookies := make([]*http.Cookie, len(result))
	for i, cookieMap := range result {
		cookie, _ := MapToCookie(cookieMap)
		cookies[i] = cookie
	}

	return cookies
}
