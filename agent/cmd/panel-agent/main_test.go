package main

import (
	"reflect"
	"testing"
)

func TestEnvBayragiHerYerde(t *testing.T) {
	cases := []struct {
		in   []string
		rest []string
		env  string
	}{
		{[]string{"show", "-env", "/a.env"}, []string{"show"}, "/a.env"},
		{[]string{"-env=/b.env", "allow", "files.*"}, []string{"allow", "files.*"}, "/b.env"},
		{[]string{"allow", "helper.x", "^a b$", "--env", "/c.env"}, []string{"allow", "helper.x", "^a b$"}, "/c.env"},
		{[]string{"show"}, []string{"show"}, ""},
	}
	for _, c := range cases {
		rest, env := extractEnvFlag(c.in)
		if !reflect.DeepEqual(rest, c.rest) || env != c.env {
			t.Errorf("%v → %v %q", c.in, rest, env)
		}
	}
}
